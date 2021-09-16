// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

enum BidType {
    /// A bid for a specific token, keyed by token ID.
    SINGLE_TOKEN,
    /// A blanket bid for any token that matches *all* of the specified traits.
    TRAITSET
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
}

/// A cancellation matches all orders that occur at or before a given timestamp
/// and fall under a given scope.
struct Cancellation {
    CancellationScope scope;
    uint256 timestamp;
}

struct CancellationScope {
    CancellationType type_;
    /// A parameter whose interpretation depends on the `type_` of this scope;
    /// see docs on `CancellationType` members for details.
    uint256 parameter;
}

enum CancellationType {
    /// Matches all asks. The associated `parameter` must be zero.
    ASKS_ALL,
    /// Matches asks with a specific nonce.
    ASKS_BY_NONCE,
    /// Matches asks on a specific token ID.
    ASKS_BY_TOKEN_ID,
    /// Matches all bids. The associated `parameter` must be zero.
    BIDS_ALL,
    /// Matches bids with a specific nonce.
    BIDS_BY_NONCE,
    /// Matches bids that specifically target a given token ID. Does not match
    /// bids on a traitset that the given token happens to match.
    BIDS_BY_TOKEN_ID,
    /// Matches bids on a given traitset. The traitset is keyed by the
    /// `keccak256` hash of the ABI encoding of the sorted `uint256[]` array of
    /// traits. This only matches bids with *exactly* the specified traitset.
    BIDS_BY_TRAITSET
}

contract Market {
    mapping(address => uint256) public cancellationTimeAsksAll;
    mapping(address => mapping(uint256 => uint256))
        public cancellationTimeAsksByNonce;
    mapping(address => mapping(uint256 => uint256))
        public cancellationTimeAsksByTokenId;

    mapping(address => uint256) public cancellationTimeBidsAll;
    mapping(address => mapping(uint256 => uint256))
        public cancellationTimeBidsByNonce;
    mapping(address => mapping(uint256 => uint256))
        public cancellationTimeBidsByTokenId;
    mapping(address => mapping(uint256 => uint256))
        public cancellationTimeBidsByTraitset;
}
