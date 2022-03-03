// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ITraitOracle.sol";

/// On Royalty Representations
///
/// Royalties take two possible forms. There are "static" and "dynamic"
/// royalties.
///
/// Static royalties consist of a specific recipient address, and a uint32
/// number of micros of royalty payment. Each micro corresponds to one
/// millionth of the purchase price.
///
/// Dynamic royalties have a royalty oracle address, and a uint32 max number
/// of micros that the oracle may allocate. The dynamic royalty also includes
/// a uint64 of arbitrary data that may be passed to the royalty oracle.
///
/// Whether a royalty is static or dynamic is encoded in the most significant
/// bit of the royalty micros value. Thus, while micros are encoded as a
/// uint32, there are only actually 31 bits available. This only rules out
/// unreasonably massive royalty values (billions of micros, or 1000x the total
/// purchase price), so it's not a serious limitation in practice. The sdk
/// prohibits setting the most significant bit in royalty micros.
///
/// Representationally, each royalty is a bytes32 where the first 20 bytes are
/// the recipient or oracle address, the next 8 bytes are the royalty oracle
/// calldata, and the final 4 bytes are the micros value.

/// Fields that a bid and ask must agree upon exactly for an order to be
/// filled.
struct OrderAgreement {
    /// Address of the ERC-20 contract being used as payment currency
    /// (typically WETH).
    IERC20 currencyAddress;
    /// Order price, in units of the ERC-20 given by `currencyAddress`.
    uint256 price;
    /// Address of the ERC-721 whose tokens are being traded.
    IERC721 tokenAddress;
    /// Royalties paid by the seller. This typically includes a royalty to the
    /// artist and to platforms supporting the token or the order.
    ///
    /// This is separated from the extra royalties on the ask to prevent token
    /// holders from taking an open bid on the orderbook and filling it without
    /// the conventional seller royalties.
    bytes32[] requiredRoyalties;
}

struct Bid {
    /// EIP-712 struct hash of the parts of this order shared between the bid
    /// and the ask, as an `OrderAgreement` struct.
    bytes32 agreementHash;
    uint256 nonce;
    /// Timestamp past which this order is no longer valid.
    uint40 deadline;
    /// Extra royalties specified by the participant who created this order.
    /// If the extra royalties are added on an Ask, they will be paid by the
    /// seller; extra royalties on a Bid are paid by the buyer (i.e. on top of
    /// the listed sale price).
    bytes32[] extraRoyalties;
    /// This is either: an encoding of the trait data that will be passed to
    /// the trait oracle (if one is provided), or the raw token id for the token
    /// being bid on (if the traitOracle is address zero).
    bytes trait;
    /// The address of the trait oracle used to interpret the trait data.
    /// If this is the zero address, the trait must be a uint256 token ID.
    ITraitOracle traitOracle;
}

struct Ask {
    /// EIP-712 struct hash of the parts of this order shared between the bid
    /// and the ask, as an `OrderAgreement` struct.
    bytes32 agreementHash;
    uint256 nonce;
    /// Timestamp past which this order is no longer valid.
    uint40 deadline;
    /// Extra royalties specified by the participant who created this order.
    /// If the extra royalties are added on an Ask, they will be paid by the
    /// seller; extra royalties on a Bid are paid by the buyer (i.e. on top of
    /// the listed sale price).
    bytes32[] extraRoyalties;
    /// The token ID listed for sale, under the token contract given by
    /// `orderAgreement.tokenAddress`.
    uint256 tokenId;
    /// Whether the asker would like their WETH proceeds to be automatically
    /// unwrapped to ETH on order execution.
    /// Purely a convenience for people who prefer ETH to WETH.
    bool unwrapWeth;
    /// The address of the account that is allowed to fill this order.
    /// If this address is the zero address, then anyone's bid may match.
    /// If this address is nonzero, they are the only address allowed to match
    /// this ask.
    address authorizedBidder;
}

library MarketMessages {
    using MarketMessages for OrderAgreement;
    using MarketMessages for bytes32[];

    bytes32 internal constant TYPEHASH_BID =
        keccak256(
            "Bid(bytes32 agreementHash,uint256 nonce,uint40 deadline,bytes32[] extraRoyalties,bytes trait,address traitOracle)"
        );
    bytes32 internal constant TYPEHASH_ASK =
        keccak256(
            "Ask(bytes32 agreementHash,uint256 nonce,uint40 deadline,bytes32[] extraRoyalties,uint256 tokenId,bool unwrapWeth,address authorizedBidder)"
        );
    bytes32 internal constant TYPEHASH_ORDER_AGREEMENT =
        keccak256(
            "OrderAgreement(address currencyAddress,uint256 price,address tokenAddress,bytes32[] requiredRoyalties)"
        );

    function structHash(Bid memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_BID,
                    _self.agreementHash,
                    _self.nonce,
                    _self.deadline,
                    _self.extraRoyalties.structHash(),
                    keccak256(_self.trait),
                    _self.traitOracle
                )
            );
    }

    function structHash(Ask memory _self) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_ASK,
                    _self.agreementHash,
                    _self.nonce,
                    _self.deadline,
                    _self.extraRoyalties.structHash(),
                    _self.tokenId,
                    _self.unwrapWeth,
                    _self.authorizedBidder
                )
            );
    }

    function structHash(OrderAgreement memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_ORDER_AGREEMENT,
                    _self.currencyAddress,
                    _self.price,
                    _self.tokenAddress,
                    _self.requiredRoyalties.structHash()
                )
            );
    }

    function structHash(bytes32[] memory _self)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_self));
    }
}
