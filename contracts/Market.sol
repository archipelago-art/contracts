// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./ITraitOracle.sol";
import "./IWeth.sol";
import "./MarketMessages.sol";
import "./SignatureChecker.sol";

contract Market {
    using MarketMessages for Bid;
    using MarketMessages for Ask;

    event BidCancellation(address indexed participant, uint256 timestamp);
    event AskCancellation(address indexed participant, uint256 timestamp);
    event NonceCancellation(address indexed participant, uint256 indexed nonce);

    event BidApproval(
        address indexed participant,
        bytes32 indexed bidHash,
        bool approved,
        Bid bid
    );
    event AskApproval(
        address indexed participant,
        bytes32 indexed askHash,
        bool approved,
        Ask ask
    );

    event Trade(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 tokenId,
        uint256 price
    );
    // Since an event may only have 3 indexed parameters, and we'd really like
    // to index on the tokenId as well, we emit an auxiliary event whose sole
    // purpose is to have the indexed tokenId alongside the corresponding
    // tradeId
    event TradeWithIndexedTokenId(
        uint256 indexed tradeId,
        uint256 indexed tokenId
    );

    IERC721 token;
    IWeth weth;
    ITraitOracle traitOracle;
    mapping(address => uint256) public bidTimestampCancellation;
    mapping(address => uint256) public askTimestampCancellation;
    mapping(address => mapping(uint256 => bool)) public nonceCancellation;

    /// `onChainApprovals[_address][_structHash]` is `true` if `_address` has
    /// provided on-chain approval of a message with hash `_structHash`.
    ///
    /// These approvals are not bounded by a domain separator; the contract
    /// storage itself is the signing domain.
    mapping(address => mapping(bytes32 => bool)) public onChainApprovals;

    string constant INVALID_ARGS = "Market: invalid args";

    string constant ORDER_CANCELLED_OR_EXPIRED =
        "Market: order cancelled or expired";

    string constant TRANSFER_FAILED = "Market: transfer failed";

    bytes32 constant TYPEHASH_DOMAIN_SEPARATOR =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );

    receive() external payable {
        // only accept ETH from the WETH contract (so we can unwrap for users)
        require(msg.sender == address(weth), "only weth contract may pay");
    }

    function initialize(
        IERC721 _token,
        IWeth _weth,
        ITraitOracle _traitOracle
    ) external {
        require(
            address(token) == address(0) &&
                address(weth) == address(0) &&
                address(traitOracle) == address(0),
            "already initialized"
        );
        token = _token;
        weth = _weth;
        traitOracle = _traitOracle;
    }

    function _computeDomainSeparator() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_DOMAIN_SEPARATOR,
                    keccak256("ArchipelagoMarket"),
                    block.chainid,
                    address(this)
                )
            );
    }

    function _verify(
        bytes32 _domainSeparator,
        bytes32 _structHash,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) internal view returns (address) {
        if (_signatureKind != SignatureKind.NO_SIGNATURE) {
            return
                SignatureChecker.recover(
                    _domainSeparator,
                    _structHash,
                    _signature,
                    _signatureKind
                );
        }
        address _signer = abi.decode(_signature, (address));
        require(
            onChainApprovals[_signer][_structHash],
            "Market: on-chain approval missing"
        );
        return _signer;
    }

    function setOnChainBidApproval(Bid memory _bid, bool _approved) external {
        bytes32 _hash = _bid.structHash();
        onChainApprovals[msg.sender][_hash] = _approved;
        emit BidApproval(msg.sender, _hash, _approved, _bid);
    }

    function setOnChainAskApproval(Ask memory _ask, bool _approved) external {
        bytes32 _hash = _ask.structHash();
        onChainApprovals[msg.sender][_hash] = _approved;
        emit AskApproval(msg.sender, _hash, _approved, _ask);
    }

    /// Computes the EIP-712 struct hash of the given bid. The resulting hash
    /// can be passed to `onChainApprovals(address, bytes32)` to check whether
    /// a given account has signed this bid.
    function bidHash(Bid memory _bid) external pure returns (bytes32) {
        return _bid.structHash();
    }

    /// Computes the EIP-712 struct hash of the given ask. The resulting hash
    /// can be passed to `onChainApprovals(address, bytes32)` to check whether
    /// a given account has signed this ask.
    function askHash(Ask memory _ask) external pure returns (bytes32) {
        return _ask.structHash();
    }

    function cancelBids(uint256 _cancellationTimestamp) external {
        require(
            _cancellationTimestamp > bidTimestampCancellation[msg.sender],
            INVALID_ARGS
        );
        require(_cancellationTimestamp <= block.timestamp, INVALID_ARGS);
        bidTimestampCancellation[msg.sender] = _cancellationTimestamp;
        emit BidCancellation(msg.sender, _cancellationTimestamp);
    }

    function cancelAsks(uint256 _cancellationTimestamp) external {
        require(
            _cancellationTimestamp > askTimestampCancellation[msg.sender],
            INVALID_ARGS
        );
        require(_cancellationTimestamp <= block.timestamp, INVALID_ARGS);
        askTimestampCancellation[msg.sender] = _cancellationTimestamp;
        emit AskCancellation(msg.sender, _cancellationTimestamp);
    }

    function cancelNonces(uint256[] memory _nonces) external {
        for (uint256 _i; _i < _nonces.length; _i++) {
            uint256 _nonce = _nonces[_i];
            nonceCancellation[msg.sender][_nonce] = true;
            emit NonceCancellation(msg.sender, _nonce);
        }
    }

    function fillOrder(
        Bid memory bid,
        bytes memory bidSignature,
        SignatureKind bidSignatureKind,
        Ask memory ask,
        bytes memory askSignature,
        SignatureKind askSignatureKind
    ) external {
        bytes32 _domainSeparator = _computeDomainSeparator();
        address bidder = _verify(
            _domainSeparator,
            bid.structHash(),
            bidSignature,
            bidSignatureKind
        );
        address asker = _verify(
            _domainSeparator,
            ask.structHash(),
            askSignature,
            askSignatureKind
        );
        _fillOrder(bid, bidder, ask, asker);
    }

    // Variant of fill order where the buyer pays in ETH (which is converted to
    // WETH under the hood). Added as a convenience. Code is mostly a repeat of
    // fillOrder, since we need to get the bidder from the signature, and then
    // convert the paid ETH to WETH.
    //
    // We don't know exactly how much the order will cost the bidder upfront
    // (we'd need to calculate royalties). So instead, the bidder just provides
    // any amount of ETH they want, which will be added to their WETH balance
    // before attempting to fill the transaction. If they haven't sent enough,
    // the tx will fail; if they sent extra, they wil have a remaining WETH
    // balance afterwards, which we assume was their intent (maybe they have
    // other bids outstanding).
    function fillOrderEth(
        Bid memory bid,
        bytes memory bidSignature,
        SignatureKind bidSignatureKind,
        Ask memory ask,
        bytes memory askSignature,
        SignatureKind askSignatureKind
    ) external payable {
        bytes32 _domainSeparator = _computeDomainSeparator();
        address bidder = _verify(
            _domainSeparator,
            bid.structHash(),
            bidSignature,
            bidSignatureKind
        );
        address asker = _verify(
            _domainSeparator,
            ask.structHash(),
            askSignature,
            askSignatureKind
        );
        require(msg.sender == bidder, "only bidder may fill with ETH");
        weth.deposit{value: msg.value}();
        weth.transfer(bidder, msg.value);
        _fillOrder(bid, bidder, ask, asker);
    }

    function _fillOrder(
        Bid memory bid,
        address bidder,
        Ask memory ask,
        address asker
    ) internal {
        bool ownerOrApproved;
        uint256 tokenId = ask.tokenId;
        address tokenOwner = token.ownerOf(tokenId);
        if (tokenOwner == asker) {
            ownerOrApproved = true;
        } else if (token.getApproved(tokenId) == asker) {
            ownerOrApproved = true;
        } else if (token.isApprovedForAll(tokenOwner, asker)) {
            ownerOrApproved = true;
        }
        require(ownerOrApproved, "asker is not owner or approved");

        require(block.timestamp <= bid.deadline, ORDER_CANCELLED_OR_EXPIRED);
        require(block.timestamp <= ask.deadline, ORDER_CANCELLED_OR_EXPIRED);

        require(
            bidTimestampCancellation[bidder] < bid.created,
            ORDER_CANCELLED_OR_EXPIRED
        );
        require(
            !nonceCancellation[bidder][bid.nonce],
            ORDER_CANCELLED_OR_EXPIRED
        );
        require(
            askTimestampCancellation[asker] < ask.created,
            ORDER_CANCELLED_OR_EXPIRED
        );
        require(
            !nonceCancellation[asker][ask.nonce],
            ORDER_CANCELLED_OR_EXPIRED
        );

        // Bids and asks are cancelled on execution, to prevent replays. Cancel
        // upfront so that external calls (`transferFrom`, `safeTransferFrom`,
        // the ERC-721 receive hook) only observe the cancelled state.
        nonceCancellation[bidder][bid.nonce] = true;
        nonceCancellation[asker][ask.nonce] = true;

        uint256 _tradeId = uint256(
            keccak256(abi.encode(bidder, bid.nonce, asker, ask.nonce))
        );
        uint256 _price = bid.price;
        uint256 _proceeds = _price; // amount that goes to the asker, after royalties
        require(_price == ask.price, "price mismatch");

        if (bid.bidType == BidType.SINGLE_TOKEN) {
            require(bid.tokenId == tokenId, "tokenid mismatch");
        } else {
            for (uint256 _i = 0; _i < bid.traitset.length; _i++) {
                require(
                    traitOracle.hasTrait(tokenId, bid.traitset[_i]),
                    "missing trait"
                );
            }
        }

        for (uint256 _i = 0; _i < ask.royalties.length; _i++) {
            Royalty memory _royalty = ask.royalties[_i];
            uint256 _amt = (_royalty.bps * _price) / 10000;
            // Proceeds to the seller are decreased by all Ask royalties
            _proceeds -= _amt;
            require(
                weth.transferFrom(bidder, _royalty.recipient, _amt),
                TRANSFER_FAILED
            );
        }

        for (uint256 _i = 0; _i < bid.royalties.length; _i++) {
            Royalty memory _royalty = bid.royalties[_i];
            uint256 _amt = (_royalty.bps * _price) / 10000;
            // Proceeds to the seller are *not* decreased by Bid royalties,
            // meaning the bidder pays them on top of the bid price.
            require(
                weth.transferFrom(bidder, _royalty.recipient, _amt),
                TRANSFER_FAILED
            );
        }

        token.safeTransferFrom(tokenOwner, bidder, tokenId);
        if (ask.unwrapWeth) {
            require(
                weth.transferFrom(bidder, address(this), _proceeds),
                TRANSFER_FAILED
            );
            weth.withdraw(_proceeds);
            // Note: This invokes the asker's fallback function. Be careful of
            // re-entrancy attacks. We deliberately invalidate the bid and ask
            // nonces before this point, to prevent replay attacks.
            payable(tokenOwner).transfer(_proceeds);
        } else {
            require(
                weth.transferFrom(bidder, tokenOwner, _proceeds),
                TRANSFER_FAILED
            );
        }

        emit Trade(_tradeId, bidder, asker, tokenId, _price);
        emit TradeWithIndexedTokenId(_tradeId, tokenId);
    }
}
