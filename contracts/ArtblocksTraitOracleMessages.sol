// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

struct SetProjectInfoMessage {
    uint256 projectId;
    uint256 version;
    string projectName;
    uint256 size;
}

struct SetFeatureInfoMessage {
    uint256 projectId;
    string featureName;
    uint256 version;
    uint256 size;
}

struct AddTraitMembershipsMessage {
    uint256 traitId;
    uint256[] tokenIds;
}

library ArtblocksTraitOracleMessages {
    bytes32 internal constant TYPEHASH_SET_PROJECT_INFO =
        keccak256(
            "SetProjectInfoMessage(uint256 projectId,uint256 version,string projectName,uint256 size)"
        );
    bytes32 internal constant TYPEHASH_SET_FEATURE_INFO =
        keccak256(
            "SetFeatureInfoMessage(uint256 projectId,string featureName,uint256 version,uint256 size)"
        );
    bytes32 internal constant TYPEHASH_ADD_TRAIT_MEMBERSHIPS =
        keccak256(
            "AddTraitMembershipsMessage(uint256 traitId,uint256[] tokenIds)"
        );
}
