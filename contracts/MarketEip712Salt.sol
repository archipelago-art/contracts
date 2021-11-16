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
    /// Address of the ERC-20 token used as currency by this market.
    IWeth weth;
}

library MarketEip712SaltSerialization {
    function serialize(MarketEip712Salt memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256( abi.encode(_self.weth));
    }
}
