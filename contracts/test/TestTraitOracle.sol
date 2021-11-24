// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "../ITraitOracle.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract TestTraitOracle is ITraitOracle {
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) membership;

    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        uint256 _traitId
    ) external view override returns (bool) {
        return membership[_traitId][address(_tokenContract)][_tokenId];
    }

    function setTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        uint256 _traitId
    ) external {
        membership[_traitId][address(_tokenContract)][_tokenId] = true;
    }
}
