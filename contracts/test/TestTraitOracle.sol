// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "../ITraitOracle.sol";

contract TestTraitOracle is ITraitOracle {
    mapping(uint256 => mapping(uint256 => bool)) membership;

    function hasTrait(uint256 _tokenId, uint256 _traitId)
        external
        view
        override
        returns (bool)
    {
        return membership[_traitId][_tokenId];
    }

    function setTrait(uint256 _tokenId, uint256 _traitId) external {
        membership[_traitId][_tokenId] = true;
    }
}
