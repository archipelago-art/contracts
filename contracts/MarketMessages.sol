// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

enum BidType {
    /// A bid for specific token ids
    TOKEN_IDS,
    // A blanket bid for any single token that matches *all* of the specified
    // traits.
    // A traitset bid will never match an Ask that is not selling exactly one
    // token.
    TRAITSET
}

struct Royalty {
    address recipient;
    // Basis points of the sale price this recipient should receive
    // one bp is 1/10,000
    uint256 bps;
}

struct Bid {
    uint256 nonce;
    /// Timestamp at which this bid was created. Affects time-based
    /// cancellations.
    uint256 created;
    /// Timestamp past which this bid is no longer valid.
    uint256 deadline;
    /// Offer price, in wei.
    uint256 price;
    BidType bidType;
    /// For `TOKEN_IDS` bids, this is the list of token ids the Bid is requesting.
    /// For `TRAITSET` bids, this will be an empty array.
    /// For TOKEN_IDS bids orders to match successfully, the bid and ask must exactly
    /// agree on the token ids, including ordering. By convention, token ids should be
    /// included in ascending order.
    uint256[] tokenIds;
    /// For `TRAITSET` bids, this is an array of trait IDs, sorted in strictly
    /// increasing order. A token must have *every* trait in this array to match
    /// the bid. The array may be empty, in which case this naturally represents
    /// a floor bid on all tokens. For non-`TRAITSET` bids, this array is empty.
    uint256[] traitset;
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
    // The tokenIds being offered in this ask (may be more than one for bundles).
    // A traitset bid can only match asks with exactly one token id.
    // For token id bids, the ids of the bid and the ask must match exactly, including
    // ordering. By convention, the token ids should be included in ascending order.
    uint256[] tokenIds;
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
            "Bid(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint8 bidType,uint256[] tokenIds,uint256[] traitset,Royalty[] royalties)Royalty(address recipient,uint256 bps)"
        );
    bytes32 internal constant TYPEHASH_ASK =
        keccak256(
            "Ask(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint256[] tokenIds,Royalty[] royalties,bool unwrapWeth,address authorizedBidder)Royalty(address recipient,uint256 bps)"
        );
    bytes32 internal constant TYPEHASH_ROYALTY =
        keccak256("Royalty(address recipient,uint256 bps)");

    function structHash(Bid memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_BID,
                    _self.nonce,
                    _self.created,
                    _self.deadline,
                    _self.price,
                    _self.bidType,
                    keccak256(abi.encodePacked(_self.tokenIds)),
                    keccak256(abi.encodePacked(_self.traitset)),
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
                    _self.price,
                    keccak256(abi.encodePacked(_self.tokenIds)),
                    _self.royalties.structHash(),
                    _self.unwrapWeth,
                    _self.authorizedBidder
                )
            );
    }

    function structHash(Royalty memory _self) internal pure returns (bytes32) {
        return
            keccak256(abi.encode(TYPEHASH_ROYALTY, _self.recipient, _self.bps));
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
