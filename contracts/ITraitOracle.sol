// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

interface ITraitOracle {
    function hasTrait(uint256 _tokenId, uint256 _traitId) external view returns (bool);
}
