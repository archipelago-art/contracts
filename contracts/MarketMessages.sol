// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

enum BidType {
    /// A bid for a specific token, keyed by token ID.
    SINGLE_TOKEN,
    /// A blanket bid for any token that matches *all* of the specified traits.
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
    /// For `SINGLE_TOKEN` bids, this is the token that the bid applies to. For
    /// other bids, this is zero.
    uint256 tokenId;
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
    uint256 tokenId;
    // Royalties that are paid by the asker, i.e. are subtracted from the amount
    // of the sale price that is given to the asker when the sale completes.
    // Artist or platform royalties (e.g. to ArtBlocks or the Archipelago protocol)
    // should be deducted from the Ask side.
    Royalty[] royalties;
}

library MarketMessages {
    bytes32 internal constant TYPEHASH_BID =
        keccak256(
            "Bid(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint8 bidType,uint256 tokenId,uint256[] traitset,Royalty[] royalties)Royalty(address recipient,uint256 bps)"
        );
    bytes32 internal constant TYPEHASH_ASK =
        keccak256(
            "Ask(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint256 tokenId,Royalty[] royalties)Royalty(address recipient,uint256 bps)"
        );
    bytes32 internal constant TYPEHASH_ROYALTY =
        keccak256("Royalty(address recipient,uint256 bps)");

    function serialize(Bid memory _self) internal pure returns (bytes memory) {
        return
            abi.encode(
                TYPEHASH_BID,
                _self.nonce,
                _self.created,
                _self.deadline,
                _self.price,
                _self.bidType,
                _self.tokenId,
                keccak256(abi.encodePacked(_self.traitset)),
                _royaltiesHash(_self.royalties)
            );
    }

    function serialize(Ask memory _self) internal pure returns (bytes memory) {
        return
            abi.encode(
                TYPEHASH_ASK,
                _self.nonce,
                _self.created,
                _self.deadline,
                _self.price,
                _self.tokenId,
                _royaltiesHash(_self.royalties)
            );
    }

    function _royaltiesHash(Royalty[] memory _self)
        private
        pure
        returns (bytes32)
    {
        bytes32[] memory _structHashes = new bytes32[](_self.length);
        for (uint256 _i = 0; _i < _self.length; _i++) {
            Royalty memory _r = _self[_i];
            _structHashes[_i] = keccak256(
                abi.encode(TYPEHASH_ROYALTY, _r.recipient, _r.bps)
            );
        }
        return keccak256(abi.encodePacked(_structHashes));
    }
}
