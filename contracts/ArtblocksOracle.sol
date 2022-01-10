// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ArtblocksOracleMessages.sol";
import "./ITraitOracle.sol";
import "./Popcnt.sol";
import "./SignatureChecker.sol";

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

/// Static information about a project trait (immutable once written).
struct ProjectInfo {
    /// The ERC-721 contract for tokens belonging to this project.
    IERC721 tokenContract;
    /// The integer index of this project: e.g., `0` for "Chromie Squiggle" or
    /// `23` for "Archetype".
    uint32 projectId;
    /// The number of tokens in this project, like `600`.
    uint32 size;
    /// The human-readable name of this project, like "Archetype".
    string name;
}

/// Static information about a feature trait (immutable once written).
struct FeatureInfo {
    /// The ERC-721 contract for tokens belonging to this trait's project.
    IERC721 tokenContract;
    /// The integer index of the project that this feature is a part of: e.g.,
    /// for the "Palette: Paddle" trait on Archetypes, this value is `23`,
    /// which is the ID of the Archetype project.
    uint32 projectId;
    /// The human-readable name of this feature, like "Palette: Paddle".
    string name;
}

/// The current state of a feature trait, updated as more memberships and
/// finalizations are recorded.
struct FeatureMetadata {
    /// The number of distinct token IDs that currently have this trait: i.e.,
    /// the sum of the population counts of `featureMembers[_t][_i]` for each
    /// `_i`.
    uint32 currentSize;
    /// Token indices `0` (inclusive) through `numFinalized` (exclusive),
    /// relative to the start of the project, have their memberships in this
    /// trait finalized.
    uint32 numFinalized;
    /// A hash accumulator of updates to this trait. Initially `0`; updated for
    /// each new message `_msg` by ABI-encoding `(log, _msg.structHash())`,
    /// applying `keccak256`, and truncating the result back to `bytes24`.
    bytes24 log;
}

contract ArtblocksOracle is IERC165, ITraitOracle, Ownable {
    using ArtblocksOracleMessages for SetProjectInfoMessage;
    using ArtblocksOracleMessages for SetFeatureInfoMessage;
    using ArtblocksOracleMessages for UpdateTraitMessage;
    using Popcnt for uint256;

    event OracleSignerChanged(address indexed oracleSigner);
    event ProjectInfoSet(
        bytes32 indexed traitId,
        uint32 indexed projectId,
        string name,
        uint32 version,
        uint32 size,
        IERC721 tokenContract
    );
    event FeatureInfoSet(
        bytes32 indexed traitId,
        uint32 indexed projectId,
        string indexed name,
        string fullName,
        uint32 version,
        IERC721 tokenContract
    );
    event TraitUpdated(
        bytes32 indexed traitId,
        uint32 newSize,
        uint32 newNumFinalized,
        bytes24 newLog
    );

    string constant ERR_ALREADY_EXISTS = "ArtblocksOracle: ALREADY_EXISTS";
    string constant ERR_IMMUTABLE = "ArtblocksOracle: IMMUTABLE";
    string constant ERR_INVALID_ARGUMENT = "ArtblocksOracle: INVALID_ARGUMENT";
    string constant ERR_INVALID_STATE = "ArtblocksOracle: INVALID_STATE";
    string constant ERR_UNAUTHORIZED = "ArtblocksOracle: UNAUTHORIZED";

    bytes32 constant TYPEHASH_DOMAIN_SEPARATOR =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );
    bytes32 constant DOMAIN_SEPARATOR_NAME_HASH = keccak256("ArtblocksOracle");

    /// Art Blocks gives each project a token space of 1 million IDs. Most IDs
    /// in this space are not actually used, but a token's ID floor-divided by
    /// this stride gives the project ID, and the token ID modulo this stride
    /// gives the token index within the project.
    uint256 constant PROJECT_STRIDE = 10**6;

    address public oracleSigner;

    mapping(bytes32 => ProjectInfo) public projectTraitInfo;
    mapping(bytes32 => FeatureInfo) public featureTraitInfo;

    /// Append-only relation on `TraitId * TokenId`, for feature traits only.
    /// (Project trait membership is determined from the token ID itself.)
    ///
    /// Encoded by packing 256 token indices into each word: if a token has
    /// index `_i` in its project (i.e., `_i == _tokenId % PROJECT_STRIDE`),
    /// then the token has trait `_t` iff the `_i % 256`th bit (counting from
    /// the LSB) of `featureMembers[_t][_i / 256]` is `1`.
    mapping(bytes32 => mapping(uint256 => uint256)) featureMembers;
    /// Metadata for each feature trait; see struct definition. Not defined for
    /// project traits.
    mapping(bytes32 => FeatureMetadata) public featureMetadata;

    // EIP-165 interface discovery boilerplate.
    function supportsInterface(bytes4 _interfaceId)
        external
        pure
        override
        returns (bool)
    {
        if (_interfaceId == type(ITraitOracle).interfaceId) return true;
        if (_interfaceId == type(IERC165).interfaceId) return true;
        return false;
    }

    function setOracleSigner(address _oracleSigner) external onlyOwner {
        oracleSigner = _oracleSigner;
        emit OracleSignerChanged(_oracleSigner);
    }

    function _requireOracleSignature(
        bytes32 _structHash,
        bytes memory _signature,
        SignatureKind _kind
    ) internal view {
        address _signer = SignatureChecker.recover(
            _computeDomainSeparator(),
            _structHash,
            _signature,
            _kind
        );
        require(_signer == oracleSigner, ERR_UNAUTHORIZED);
    }

    function _computeDomainSeparator() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_DOMAIN_SEPARATOR,
                    DOMAIN_SEPARATOR_NAME_HASH,
                    block.chainid,
                    address(this)
                )
            );
    }

    function setProjectInfo(
        SetProjectInfoMessage memory _msg,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) external {
        _requireOracleSignature(_msg.structHash(), _signature, _signatureKind);

        // Input fields must be non-empty (but project ID may be 0).
        require(_msg.size > 0, ERR_INVALID_ARGUMENT);
        require(
            _msg.tokenContract != IERC721(address(0)),
            ERR_INVALID_ARGUMENT
        );
        require(!_stringEmpty(_msg.projectName), ERR_INVALID_ARGUMENT);

        // Project must not already exist.
        bytes32 _traitId = projectTraitId(_msg.projectId, _msg.version);
        require(projectTraitInfo[_traitId].size == 0, ERR_ALREADY_EXISTS);

        projectTraitInfo[_traitId] = ProjectInfo({
            projectId: _msg.projectId,
            name: _msg.projectName,
            size: _msg.size,
            tokenContract: _msg.tokenContract
        });
        emit ProjectInfoSet({
            traitId: _traitId,
            projectId: _msg.projectId,
            name: _msg.projectName,
            version: _msg.version,
            size: _msg.size,
            tokenContract: _msg.tokenContract
        });
    }

    function setFeatureInfo(
        SetFeatureInfoMessage memory _msg,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) external {
        _requireOracleSignature(_msg.structHash(), _signature, _signatureKind);

        // Input fields must be non-empty (but project ID may be 0).
        require(
            _msg.tokenContract != IERC721(address(0)),
            ERR_INVALID_ARGUMENT
        );
        require(!_stringEmpty(_msg.featureName), ERR_INVALID_ARGUMENT);

        // Feature must not already exist.
        bytes32 _traitId = featureTraitId(
            _msg.projectId,
            _msg.featureName,
            _msg.version
        );
        require(
            featureTraitInfo[_traitId].tokenContract == IERC721(address(0)),
            ERR_ALREADY_EXISTS
        );

        featureTraitInfo[_traitId] = FeatureInfo({
            projectId: _msg.projectId,
            name: _msg.featureName,
            tokenContract: _msg.tokenContract
        });
        emit FeatureInfoSet({
            traitId: _traitId,
            projectId: _msg.projectId,
            name: _msg.featureName,
            fullName: _msg.featureName,
            version: _msg.version,
            tokenContract: _msg.tokenContract
        });
    }

    function updateTrait(
        UpdateTraitMessage memory _msg,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) external {
        bytes32 _structHash = _msg.structHash();
        _requireOracleSignature(_structHash, _signature, _signatureKind);

        bytes32 _traitId = _msg.traitId;
        // Feature must exist.
        require(
            featureTraitInfo[_traitId].tokenContract != IERC721(address(0)),
            ERR_INVALID_ARGUMENT
        );
        FeatureMetadata memory _oldMetadata = featureMetadata[_traitId];

        // Check whether we're increasing the number of finalized tokens.
        // If so, the current trait log must match the given one.
        uint32 _newNumFinalized = _oldMetadata.numFinalized;
        uint32 _msgNumFinalized = uint32(uint256(_msg.finalization));
        if (_msgNumFinalized > _newNumFinalized) {
            _newNumFinalized = _msgNumFinalized;
            bytes24 _expectedLastLog = bytes24(_msg.finalization);
            require(_oldMetadata.log == _expectedLastLog, ERR_INVALID_STATE);
        }

        // Add any new token memberships.
        uint32 _newSize = _oldMetadata.currentSize;
        for (uint256 _i = 0; _i < _msg.words.length; _i++) {
            TraitMembershipWord memory _word = _msg.words[_i];
            uint256 _wordIndex = _word.wordIndex;

            uint256 _oldWord = featureMembers[_traitId][_wordIndex];
            uint256 _newTokensMask = _word.mask & ~_oldWord;

            // It's an error to update any tokens in this word that are already
            // finalized (i.e., were finalized prior to this message).
            uint256 _errantUpdatesMask = _newTokensMask &
                _finalizedTokensMask(_oldMetadata.numFinalized, _wordIndex);
            require(_errantUpdatesMask == 0, ERR_IMMUTABLE);

            featureMembers[_traitId][_wordIndex] = _oldWord | _newTokensMask;
            _newSize += uint32(_newTokensMask.popcnt());
        }

        // If this message didn't add or finalize any new memberships, we don't
        // want to update the hash log *or* emit an event.
        bool _wasNoop = (_newSize == _oldMetadata.currentSize) &&
            (_newNumFinalized == _oldMetadata.numFinalized);
        if (_wasNoop) return;

        // If we either added or finalized memberships, update the hash log.
        bytes24 _oldLog = _oldMetadata.log;
        bytes24 _newLog = bytes24(keccak256(abi.encode(_oldLog, _structHash)));

        FeatureMetadata memory _newMetadata = FeatureMetadata({
            currentSize: _newSize,
            numFinalized: _newNumFinalized,
            log: _newLog
        });
        featureMetadata[_traitId] = _newMetadata;

        emit TraitUpdated({
            traitId: _traitId,
            newSize: _newSize,
            newNumFinalized: _newNumFinalized,
            newLog: _newLog
        });
    }

    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes calldata _trait
    ) external view override returns (bool) {
        bytes32 _traitId = bytes32(_trait);

        uint8 _discriminant = uint8(uint256(_traitId));
        if (_discriminant == uint8(TraitType.PROJECT)) {
            return _hasProjectTrait(_tokenContract, _tokenId, _traitId);
        } else if (_discriminant == uint8(TraitType.FEATURE)) {
            return _hasFeatureTrait(_tokenContract, _tokenId, _traitId);
        } else {
            return false;
        }
    }

    function _hasProjectTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes32 _traitId
    ) internal view returns (bool) {
        ProjectInfo storage _info = projectTraitInfo[_traitId];
        IERC721 _projectContract = _info.tokenContract;
        uint256 _projectId = _info.projectId;
        uint256 _projectSize = _info.size;

        if (_tokenContract != _projectContract) return false;
        if (_tokenId / PROJECT_STRIDE != _projectId) return false;
        if (_tokenId % PROJECT_STRIDE >= _projectSize) return false;
        return true;
    }

    function _hasFeatureTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes32 _traitId
    ) internal view returns (bool) {
        FeatureInfo storage _info = featureTraitInfo[_traitId];
        IERC721 _traitContract = _info.tokenContract;
        uint256 _projectId = _info.projectId;

        if (_tokenContract != _traitContract) return false;
        if (_tokenId / PROJECT_STRIDE != _projectId) return false;

        uint256 _tokenIndex = _tokenId - (uint256(_projectId) * PROJECT_STRIDE);
        uint256 _wordIndex = _tokenIndex >> 8;
        uint256 _mask = 1 << (_tokenIndex & 0xff);
        return (featureMembers[_traitId][_wordIndex] & _mask) != 0;
    }

    function projectTraitId(uint32 _projectId, uint32 _version)
        public
        pure
        returns (bytes32)
    {
        bytes memory _blob = abi.encode(
            TraitType.PROJECT,
            _projectId,
            _version
        );
        uint256 _hash = uint256(keccak256(_blob));
        return bytes32((_hash & ~uint256(0xff)) | uint256(TraitType.PROJECT));
    }

    function featureTraitId(
        uint32 _projectId,
        string memory _featureName,
        uint32 _version
    ) public pure returns (bytes32) {
        bytes memory _blob = abi.encode(
            TraitType.FEATURE,
            _projectId,
            _featureName,
            _version
        );
        uint256 _hash = uint256(keccak256(_blob));
        return bytes32((_hash & ~uint256(0xff)) | uint256(TraitType.FEATURE));
    }

    /// Dumb helper to test whether a string is empty, because Solidity doesn't
    /// expose `_s.length` for a string `_s`.
    function _stringEmpty(string memory _s) internal pure returns (bool) {
        return bytes(_s).length == 0;
    }

    /// Given that the first `_numFinalized` tokens for trait `_t` have been
    /// finalized, returns a mask into `featureMembers[_t][_wordIndex]` of
    /// memberships that are finalized and thus not permitted to be updated.
    ///
    /// For instance, if `_numFinalized == 259`, then token indices 0 through 258
    /// (inclusive) have been finalized, so:
    ///
    ///     `_finalizedTokensMask(259, 0) == ~0`
    ///         because all tokens in word 0 have been finalized
    ///         be updated
    ///     `_finalizedTokensMask(259, 1) == (1 << 3) - 1`
    ///         because the first three tokens (256, 257, 258) within this word
    ///         have been finalized, so the result has the low 3 bits set
    ///     `_finalizedTokensMask(259, 2) == 0`
    ///         because no tokens in word 2 (or higher) have been finalized
    function _finalizedTokensMask(uint32 _numFinalized, uint256 _wordIndex)
        internal
        pure
        returns (uint256)
    {
        uint256 _firstTokenInWord = _wordIndex << 8;
        if (_numFinalized < _firstTokenInWord) {
            // Nothing in this word is finalized.
            return 0;
        }
        uint256 _numFinalizedSinceStartOfWord = uint256(_numFinalized) -
            _firstTokenInWord;
        if (_numFinalizedSinceStartOfWord > 0xff) {
            // Everything in this word is finalized.
            return ~uint256(0);
        }
        // Otherwise, between 0 and 255 tokens in this word are finalized; form
        // a mask of their indices.
        //
        // (This subtraction doesn't underflow because the shift produces a
        // nonzero value, given the bounds on `_numFinalizedSinceStartOfWord`.)
        return (1 << _numFinalizedSinceStartOfWord) - 1;
    }
}
