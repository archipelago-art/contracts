// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

interface ITraitOracle {
    /// Queries whether the given NFT has the given trait. The NFT is specified
    /// by token ID only; the token contract is assumed to be known already.
    /// For instance, a trait oracle could be designed for a specific token
    /// contract, or it could call a method on `msg.sender` to determine what
    /// contract to use.
    ///
    /// The interpretation of trait IDs may be domain-specific and is at the
    /// discretion of the trait oracle. For example, an oracle might choose to
    /// encode traits called "Normal" and "Rare" as `0` and `1` respectively,
    /// or as `uint256(keccak256("Normal"))` and `uint256(keccak256("Rare"))`,
    /// or as something else. The trait oracle may expose other domain-specific
    /// methods to describe these traits.
    function hasTrait(uint256 _tokenId, uint256 _traitId)
        external
        view
        returns (bool);
}
