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
    event TraitMembershipExpanded(uint256 indexed traitId, uint256 newSize);

    string constant ERR_ALREADY_EXISTS = "ArtblocksTraitOracle: ALREADY_EXISTS";
    string constant ERR_INVALID_ARGUMENT =
        "ArtblocksTraitOracle: INVALID_ARGUMENT";
    string constant ERR_UNAUTHORIZED = "ArtblocksTraitOracle: UNAUTHORIZED";

    uint256 constant TOKENS_PER_PROJECT = 10**6;

    address admin;

    mapping(uint256 => ProjectInfo) public projectTraitInfo;
    mapping(uint256 => FeatureInfo) public featureTraitInfo;

    /// Append-only relation on `TraitId * TokenId`, for feature traits only.
    /// (Project trait membership is tracked implicitly through Art Blocks
    /// token IDs.)
    mapping(uint256 => mapping(uint256 => bool)) traitMembers;
    /// `traitMembersCount[_traitId]` is the number of distinct `_tokenId`s
    /// such that `traitMembers[_traitId][_tokenId]` is true.
    mapping(uint256 => uint256) traitMembersCount;

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

    /// Adds tokens as members of a feature trait.
    function addTraitMemberships(uint256 _traitId, uint256[] memory _tokenIds)
        external
        onlyAdmin
    {
        uint256 _finalSize = featureTraitInfo[_traitId].size;
        uint256 _originalSize = traitMembersCount[_traitId];
        uint256 _newSize = _originalSize;
        for (uint256 _i = 0; _i < _tokenIds.length; _i++) {
            uint256 _tokenId = _tokenIds[_i];
            if (traitMembers[_traitId][_tokenId]) continue;
            traitMembers[_traitId][_tokenId] = true;
            _newSize++;
            if (_newSize > _finalSize) revert(ERR_INVALID_ARGUMENT);
        }
        if (_newSize == _originalSize) return;
        traitMembersCount[_traitId] = _newSize;
        emit TraitMembershipExpanded({traitId: _traitId, newSize: _newSize});
    }

    function hasTrait(uint256 _tokenId, uint256 _traitId)
        external
        view
        override
        returns (bool)
    {
        // Check project traits first, since this only requires a single
        // storage lookup if `_traitId` represents a feature trait.
        return
            _hasProjectTrait(_tokenId, _traitId) ||
            _hasFeatureTrait(_tokenId, _traitId);
    }

    function _hasProjectTrait(uint256 _tokenId, uint256 _traitId)
        internal
        view
        returns (bool)
    {
        uint256 _projectSize = projectTraitInfo[_traitId].size;
        if (_projectSize == 0) return false; // gas

        uint256 _tokenProjectId = _tokenId / TOKENS_PER_PROJECT;
        uint256 _traitProjectId = projectTraitInfo[_traitId].projectId;
        if (_tokenProjectId != _traitProjectId) return false;

        uint256 _tokenIndexInProject = _tokenId % TOKENS_PER_PROJECT;
        if (_tokenIndexInProject >= _projectSize) return false;

        return true;
    }

    function _hasFeatureTrait(uint256 _tokenId, uint256 _traitId)
        internal
        view
        returns (bool)
    {
        uint256 _finalSize = featureTraitInfo[_traitId].size;
        uint256 _currentSize = traitMembersCount[_traitId];
        // Before a trait's membership is finalized, we don't affirm any
        // memberships.
        if (_currentSize < _finalSize) return false;
        return traitMembers[_traitId][_tokenId];
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
