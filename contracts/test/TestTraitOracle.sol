// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "../ITraitOracle.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract TestTraitOracle is ITraitOracle {
    mapping(bytes32 => mapping(address => mapping(uint256 => bool))) shouldRevert;
    mapping(bytes32 => mapping(address => mapping(uint256 => bool))) membership;

    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external view override returns (bool) {
        bytes32 _traitId = keccak256(_trait);
        if (shouldRevert[_traitId][address(_tokenContract)][_tokenId])
            revert("TestTraitOracle: kaboom!");
        return membership[_traitId][address(_tokenContract)][_tokenId];
    }

    function setRevert(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external {
        bytes32 _traitId = keccak256(_trait);
        shouldRevert[_traitId][address(_tokenContract)][_tokenId] = true;
    }

    function setTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external {
        bytes32 _traitId = keccak256(_trait);
        membership[_traitId][address(_tokenContract)][_tokenId] = true;
    }

    function setHashes(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes32[] calldata _hashes
    ) external {
        for (uint256 _i = 0; _i < _hashes.length; _i++) {
            bytes32 _traitId = _hashes[_i];
            membership[_traitId][address(_tokenContract)][_tokenId] = true;
        }
    }
}
