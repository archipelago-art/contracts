// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ITraitOracle.sol";

struct Royalty {
    address recipient;
    /// Millionths of the sale price that this recipient should get.
    /// I.e. the royalty will be price * micros * 10^-6
    uint256 micros;
}

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
    Royalty[] requiredRoyalties;
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
    Royalty[] extraRoyalties;
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
    Royalty[] extraRoyalties;
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
    using MarketMessages for Royalty;
    using MarketMessages for Royalty[];

    bytes32 internal constant TYPEHASH_BID =
        keccak256(
            "Bid(bytes32 agreementHash,uint256 nonce,uint40 deadline,Royalty[] extraRoyalties,bytes trait,address traitOracle)Royalty(address recipient,uint256 micros)"
        );
    bytes32 internal constant TYPEHASH_ASK =
        keccak256(
            "Ask(bytes32 agreementHash,uint256 nonce,uint40 deadline,Royalty[] extraRoyalties,uint256 tokenId,bool unwrapWeth,address authorizedBidder)Royalty(address recipient,uint256 micros)"
        );
    bytes32 internal constant TYPEHASH_ORDER_AGREEMENT =
        keccak256(
            "OrderAgreement(address currencyAddress,uint256 price,address tokenAddress,Royalty[] requiredRoyalties)Royalty(address recipient,uint256 micros)"
        );
    bytes32 internal constant TYPEHASH_ROYALTY =
        keccak256("Royalty(address recipient,uint256 micros)");

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
