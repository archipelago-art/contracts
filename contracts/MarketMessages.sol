// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ITraitOracle.sol";

enum BidType {
    /// A bid for a specific token, keyed by token ID.
    TOKEN_ID,
    /// A blanket bid for any token that matches *all* of the specified traits.
    TRAITSET
}

struct Royalty {
    address recipient;
    // Millionths of the sale price that this recipient should get.
    // I.e. the royalty will be price * micros * 10^-6
    uint256 micros;
}

struct Bid {
    uint256 nonce;
    /// Timestamp at which this bid was created. Affects time-based
    /// cancellations.
    uint256 created;
    /// Timestamp past which this bid is no longer valid.
    uint256 deadline;
    /// Address of the ERC-20 contract being used as payment currency.
    /// (typically WETH)
    IERC20 currencyAddress;
    /// Offer price, in wei.
    uint256 price;
    BidType bidType;
    /// Address of the ERC-721 whose tokens are being traded
    IERC721 tokenAddress;
    /// For `TOKEN_ID` bids, this is the token that the bid applies to. For
    /// other bids, this is zero.
    uint256 tokenId;
    /// For `TRAITSET` bids, this is an array of trait IDs, sorted in strictly
    /// increasing order. A token must have *every* trait in this array to match
    /// the bid. The array may be empty, in which case this naturally represents
    /// a floor bid on all tokens. For non-`TRAITSET` bids, this array is empty.
    uint256[] traitset;
    /// For `TRAITSET` bids, this must be the address of a Trait oracle that is
    //trusted / to determine trait membership for this bid. for non-`TRAITSET`
    //bids, this will / be the zero address.
    ITraitOracle traitOracle;
    // Royalties specified by the bidder. These royalties are added _on top of_ the
    // sale price. These are paid to agents that directly helped the bidder, e.g.
    // a broker who is helping the bidder, or to the frontend marketplace that
    // the bidder is operating from. By convention, artist and platform royalties
    // are paid by the seller, not the bidder.
    Royalty[] royalties;
}

struct Ask {
    uint256 nonce;
    /// Timestamp at which this ask was created. Affects time-based
    /// cancellations.
    uint256 created;
    /// Timestamp past which this ask is no longer valid.
    uint256 deadline;
    /// List price, in wei.
    uint256 price;
    /// Address of the ERC-20 contract being used as payment currency.
    /// (typically WETH)
    IERC20 currencyAddress;
    /// Address of the ERC-721 whose tokens are being traded
    IERC721 tokenAddress;
    uint256 tokenId;
    // Royalties that are paid by the asker, i.e. are subtracted from the amount
    // of the sale price that is given to the asker when the sale completes.
    // Artist or platform royalties (e.g. to ArtBlocks or the Archipelago protocol)
    // should be deducted from the Ask side.
    Royalty[] royalties;
    // Whether the asker would like their WETH proceeds to be automatically
    // unwrapped to ETH on order execution.
    // Purely a convenience for people who prefer ETH to WETH.
    bool unwrapWeth;
    // The address of the account that is allowed to fill this order.
    // If this address is the zero address, then anyone's bid may match.
    // If this address is nonzero, they are the only address allowed to match
    // this ask.
    address authorizedBidder;
}

library MarketMessages {
    using MarketMessages for Royalty;
    using MarketMessages for Royalty[];

    bytes32 internal constant TYPEHASH_BID =
        keccak256(
            "Bid(uint256 nonce,uint256 created,uint256 deadline,address currencyAddress,uint256 price,uint8 bidType,address tokenAddress,uint256 tokenId,uint256[] traitset,address traitOracle,Royalty[] royalties)Royalty(address recipient,uint256 micros)"
        );
    bytes32 internal constant TYPEHASH_ASK =
        keccak256(
            "Ask(uint256 nonce,uint256 created,uint256 deadline,address currencyAddress,uint256 price,address tokenAddress,uint256 tokenId,Royalty[] royalties,bool unwrapWeth,address authorizedBidder)Royalty(address recipient,uint256 micros)"
        );
    bytes32 internal constant TYPEHASH_ROYALTY =
        keccak256("Royalty(address recipient,uint256 micros)");

    function structHash(Bid memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_BID,
                    _self.nonce,
                    _self.created,
                    _self.deadline,
                    _self.currencyAddress,
                    _self.price,
                    _self.bidType,
                    _self.tokenAddress,
                    _self.tokenId,
                    keccak256(abi.encodePacked(_self.traitset)),
                    _self.traitOracle,
                    _self.royalties.structHash()
                )
            );
    }

    function structHash(Ask memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_ASK,
                    _self.nonce,
                    _self.created,
                    _self.deadline,
                    _self.currencyAddress,
                    _self.price,
                    _self.tokenAddress,
                    _self.tokenId,
                    _self.royalties.structHash(),
                    _self.unwrapWeth,
                    _self.authorizedBidder
                )
            );
    }

    function structHash(Royalty memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(TYPEHASH_ROYALTY, _self.recipient, _self.micros)
            );
    }

    function structHash(Royalty[] memory _self)
        internal
        pure
        returns (bytes32)
    {
        bytes32[] memory _structHashes = new bytes32[](_self.length);
        for (uint256 _i = 0; _i < _self.length; _i++) {
            _structHashes[_i] = _self[_i].structHash();
        }
        return keccak256(abi.encodePacked(_structHashes));
    }
}
