// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "./ITraitOracle.sol";

enum TraitType {
    /// A trait that represents an Art Blocks project, like "Chromie Squiggle"
    /// or "Archetype". Keyed by project ID, a small non-negative integer.
    PROJECT,
    /// A trait that represents a feature within a particular Art Blocks
    /// project, like a specific color palette of Archetype ("Palette: Paddle")
    /// or a specific body type of Algobot ("Bodywork: Wedge"). Keyed by
    /// project ID (a small non-negative integer) and human-readable trait name
    /// (a string).
    FEATURE
}

struct ProjectInfo {
    /// The integer index of this project: e.g., `0` for "Chromie Squiggle" or
    /// `23` for "Archetype".
    uint256 projectId;
    /// The human-readable name of this project, like "Archetype".
    string name;
    /// The number of tokens in this project, like `600`.
    uint256 size;
}

struct FeatureInfo {
    /// The integer index of the project that this feature is a part of: e.g.,
    /// for the "Palette: Paddle" trait on Archetypes, this value is `23`,
    /// which is the ID of the Archetype project.
    uint256 projectId;
    /// The human-readable name of this feature, like "Palette: Paddle".
    string name;
    /// The number of tokens that have this feature, like `12`.
    uint256 size;
}

contract ArtblocksTraitOracle is ITraitOracle {
    event AdminChanged(address indexed admin);
    event ProjectInfoSet(
        uint256 indexed traitId,
        uint256 indexed projectId,
        uint256 version,
        uint256 size
    );
    event FeatureInfoSet(
        uint256 indexed traitId,
        uint256 indexed projectId,
        string indexed name,
        uint256 version,
        uint256 size
    );

    string constant ERR_ALREADY_EXISTS = "ArtblocksTraitOracle: ALREADY_EXISTS";
    string constant ERR_INVALID_ARGUMENT =
        "ArtblocksTraitOracle: INVALID_ARGUMENT";
    string constant ERR_UNAUTHORIZED = "ArtblocksTraitOracle: UNAUTHORIZED";

    address admin;

    mapping(uint256 => ProjectInfo) public projectTraitInfo;
    mapping(uint256 => FeatureInfo) public featureTraitInfo;

    constructor() {
        admin = msg.sender;
        emit AdminChanged(msg.sender);
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, ERR_UNAUTHORIZED);
        _;
    }

    function setProjectInfo(
        uint256 _projectId,
        uint256 _version,
        string memory _projectName,
        uint256 _size
    ) external onlyAdmin {
        require(!_stringEmpty(_projectName), ERR_INVALID_ARGUMENT);
        uint256 _traitId = projectTraitId(_projectId, _version);
        require(
            _stringEmpty(projectTraitInfo[_traitId].name),
            ERR_ALREADY_EXISTS
        );
        projectTraitInfo[_traitId] = ProjectInfo({
            projectId: _projectId,
            name: _projectName,
            size: _size
        });
        emit ProjectInfoSet({
            traitId: _traitId,
            projectId: _projectId,
            version: _version,
            size: _size
        });
    }

    function setFeatureInfo(
        uint256 _projectId,
        string memory _featureName,
        uint256 _version,
        uint256 _size
    ) external onlyAdmin {
        require(!_stringEmpty(_featureName), ERR_INVALID_ARGUMENT);
        uint256 _traitId = featureTraitId(_projectId, _featureName, _version);
        require(
            _stringEmpty(featureTraitInfo[_traitId].name),
            ERR_ALREADY_EXISTS
        );
        featureTraitInfo[_traitId] = FeatureInfo({
            projectId: _projectId,
            name: _featureName,
            size: _size
        });
        emit FeatureInfoSet({
            traitId: _traitId,
            projectId: _projectId,
            name: _featureName,
            version: _version,
            size: _size
        });
    }

    function projectTraitId(uint256 _projectId, uint256 _version)
        public
        pure
        returns (uint256)
    {
        bytes memory _blob = abi.encode(
            TraitType.PROJECT,
            _projectId,
            _version
        );
        return uint256(keccak256(_blob));
    }

    function featureTraitId(
        uint256 _projectId,
        string memory _featureName,
        uint256 _version
    ) public pure returns (uint256) {
        bytes memory _blob = abi.encode(
            TraitType.FEATURE,
            _projectId,
            _featureName,
            _version
        );
        return uint256(keccak256(_blob));
    }

    /// Dumb helper to test whether a string is empty, because Solidity doesn't
    /// expose `_s.length` for a string `_s`. Could be replaced by inline
    /// assembly (basically like `_len := mload(_s); return _len == 0`), which
    /// might(?) avoid expensive copies but is obnoxious.
    function _stringEmpty(string memory _s) internal pure returns (bool) {
        return bytes(_s).length == 0;
    }
}
