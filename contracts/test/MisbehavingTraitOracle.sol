// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// A trait oracle that returns arbitrary `uint256`s instead of just `bool`s.
contract MisbehavingTraitOracle {
    mapping(bytes32 => mapping(address => mapping(uint256 => uint256))) result;

    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external view returns (uint256) {
        bytes32 _traitId = keccak256(_trait);
        return result[_traitId][address(_tokenContract)][_tokenId];
    }

    function setTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait,
        uint256 _result
    ) external {
        bytes32 _traitId = keccak256(_trait);
        result[_traitId][address(_tokenContract)][_tokenId] = _result;
    }
}
