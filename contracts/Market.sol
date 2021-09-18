// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./ITraitOracle.sol";

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

contract Market {
    event BidCancellation(address indexed participant, uint256 timestamp);
    event AskCancellation(address indexed participant, uint256 timestamp);
    event NonceCancellation(address indexed participant, uint256 indexed nonce);

    IERC721 token;
    IERC20 weth;
    ITraitOracle traitOracle;
    mapping(address => uint256) public bidTimestampCancellation;
    mapping(address => uint256) public askTimestampCancellation;
    mapping(address => mapping(uint256 => bool)) public nonceCancellation;

    string constant INVALID_ARGS = "Market: invalid args";

    string constant ORDER_CANCELLED_OR_EXPIRED =
        "Market: order cancelled or expired";

    function initialize(
        IERC721 _token,
        IERC20 _weth,
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

    function _verify(bytes memory _message, bytes memory _signature)
        internal
        pure
        returns (address)
    {
        bytes32 _rawHash = keccak256(_message);
        bytes32 _ethMessageHash = ECDSA.toEthSignedMessageHash(_rawHash);
        return ECDSA.recover(_ethMessageHash, _signature);
    }

    function cancelBids(uint256 _cancellationTimestamp) external {
        require(
            _cancellationTimestamp > bidTimestampCancellation[msg.sender],
            INVALID_ARGS
        );
        bidTimestampCancellation[msg.sender] = _cancellationTimestamp;
        emit BidCancellation(msg.sender, _cancellationTimestamp);
    }

    function cancelAsks(uint256 _cancellationTimestamp) external {
        require(
            _cancellationTimestamp > askTimestampCancellation[msg.sender],
            INVALID_ARGS
        );
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
            weth.transferFrom(bidder, _royalty.recipient, _amt);
        }

        for (uint256 _i = 0; _i < bid.royalties.length; _i++) {
            Royalty memory _royalty = bid.royalties[_i];
            uint256 _amt = (_royalty.bps * _price) / 10000;
            // Proceeds to the seller are *not* decreased by Bid royalties,
            // meaning the bidder pays them on top of the bid price.
            weth.transferFrom(bidder, _royalty.recipient, _amt);
        }

        token.safeTransferFrom(tokenOwner, bidder, tokenId);
        weth.transferFrom(bidder, tokenOwner, _proceeds);

        // bids and asks are cancelled on execution, to prevent replays
        nonceCancellation[bidder][bid.nonce] = true;
        nonceCancellation[asker][ask.nonce] = true;
    }
}
