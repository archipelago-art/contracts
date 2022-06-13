// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface ITraitOracle {
    /// Queries whether the given ERC-721 token has the given trait.
    ///
    /// The interpretation of the trait bytestring may be domain-specific and
    /// is at the discretion of the trait oracle. For example, an oracle might
    /// choose to encode traits called "Normal" and "Rare" as `"\x00"` and
    /// `"\x01"` respectively, or as `bytes(keccak256("Normal"))` and
    /// `bytes(keccak256("Rare"))`, or as something else. The trait oracle may
    /// expose other domain-specific methods to describe these traits.
    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external view returns (bool);
}
