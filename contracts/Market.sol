// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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
    /// Matches all bids. The associated `parameter` must be zero.
    BIDS_ALL,
    /// Matches bids with a specific nonce.
    BIDS_BY_NONCE
}

contract Market {
    IERC721 token;
    IERC20 weth;
    mapping(address => uint256) public bidTimestampCancellation;
    mapping(address => mapping(uint256 => bool)) public bidNonceCancellation;
    mapping(address => uint256) public askTimestampCancellation;
    mapping(address => mapping(uint256 => bool)) public askNonceCancellation;

    function initialize(IERC721 _token, IERC20 _weth) external {
        require(
            address(token) == address(0) && address(weth) == address(0),
            "already initialized"
        );
        token = _token;
        weth = _weth;
    }

    function _verify(bytes memory _message, bytes memory _signature)
        internal
        pure
        returns (address)
    {
        bytes32 _rawHash = keccak256(_message);
        bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(_rawHash);
        return ECDSA.recover(_ethMessageHash, _signature);
    }

    function fillOrder(
        Bid memory bid,
        bytes memory bidSignature,
        Ask memory ask,
        bytes memory askSignature
    ) external {
        bytes memory bidMessage = abi.encode(bid);
        bytes memory askMessage = abi.encode(ask);

        address bidder = _verify(bidMessage, bidSignature);
        address asker = _verify(askMessage, askSignature);

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
        }
        if (token.getApproved(tokenId) == asker) {
            ownerOrApproved = true;
        }
        if (token.isApprovedForAll(tokenOwner, asker)) {
            ownerOrApproved = true;
        }
        require(ownerOrApproved, "asker is not owner or approved");

        require(block.timestamp <= bid.deadline, "bid expired");
        require(block.timestamp <= ask.deadline, "ask expired");

        require(
            bidTimestampCancellation[bidder] < bid.created,
            "bid cancelled (timestamp)"
        );
        require(
            !bidNonceCancellation[bidder][bid.nonce],
            "bid cancelled (nonce)"
        );
        require(
            askTimestampCancellation[asker] < ask.created,
            "ask cancelled (timestamp)"
        );
        require(
            !askNonceCancellation[asker][ask.nonce],
            "ask cancelled (nonce)"
        );

        require(bid.price == ask.price, "price mismatch");

        if (bid.bidType == BidType.SINGLE_TOKEN) {
            require(bid.tokenId == ask.tokenId, "tokenid mismatch");
        } else {
            revert("not yet supported");
            // TODO: Consult trait oracle and verify tokenid is included in trait.
        }

        token.safeTransferFrom(asker, bidder, tokenId);
        weth.transferFrom(bidder, asker, bid.price);
        // TODO: royalties

        // bids and asks are cancelled on execution, to prevent replays
        bidNonceCancellation[bidder][bid.nonce] = true;
        askNonceCancellation[asker][ask.nonce] = true;
    }
}
