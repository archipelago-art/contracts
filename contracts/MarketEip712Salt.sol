// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./ITraitOracle.sol";
import "./IWeth.sol";

/// Data that populates the `salt` field of the EIP-712 domain for the `Market`
/// contract.
///
/// This structure does not have an explicit version, domain, or type hash. If
/// we want to invalidate it, we'll upgrade the `version` field on the `Market`
/// EIP-712 domain itself.
struct MarketEip712Salt {
    /// Address of the NFT contract whose tokens may be traded in this market.
    ///
    /// We depend on this instead of the `verifyingContract` address of the
    /// market itself so that different instantiations of markets for the same
    /// token contract can share a signing domain. In particular, this provides
    /// a natural way to upgrade the protocol or its implementation while still
    /// honoring old signatures. If we want to upgrade the protocol and *not*
    /// honor old signatures, we can just require a higher value of the
    /// `version` field.
    IERC721 tokenContract;
    /// Address of the ERC-20 token used as currency by this market.
    IWeth weth;
    /// Address of the oracle used by this market to determine which tokens
    /// have which traits.
    ITraitOracle traitOracle;
}

library MarketEip712SaltSerialization {
    function serialize(MarketEip712Salt memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(_self.tokenContract, _self.weth, _self.traitOracle)
            );
    }
}
