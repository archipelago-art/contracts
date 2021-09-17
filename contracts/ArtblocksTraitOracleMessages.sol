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
