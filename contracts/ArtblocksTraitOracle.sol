// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ArtblocksTraitOracleMessages.sol";
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
}

struct FeatureMetadata {
    /// The number of distinct token IDs that currently have this trait: i.e.,
    /// the sum of the population counts of `traitMembers[_t][_i]` for each
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

contract ArtblocksTraitOracle is IERC165, ITraitOracle, Ownable {
    using ArtblocksTraitOracleMessages for SetProjectInfoMessage;
    using ArtblocksTraitOracleMessages for SetFeatureInfoMessage;
    using ArtblocksTraitOracleMessages for AddTraitMembershipsMessage;
    using Popcnt for uint256;

    event OracleSignerChanged(address indexed oracleSigner);
    event ProjectInfoSet(
        bytes32 indexed traitId,
        uint256 indexed projectId,
        string name,
        uint256 version,
        uint256 size
    );
    event FeatureInfoSet(
        bytes32 indexed traitId,
        uint256 indexed projectId,
        string indexed name,
        string fullName,
        uint256 version
    );
    event TraitUpdated(
        bytes32 indexed traitId,
        uint32 newSize,
        uint32 newNumFinalized,
        bytes24 newLog
    );

    string constant ERR_ALREADY_EXISTS = "ArtblocksTraitOracle: ALREADY_EXISTS";
    string constant ERR_IMMUTABLE = "ArtblocksTraitOracle: IMMUTABLE";
    string constant ERR_INVALID_ARGUMENT =
        "ArtblocksTraitOracle: INVALID_ARGUMENT";
    string constant ERR_INVALID_STATE = "ArtblocksTraitOracle: INVALID_STATE";
    string constant ERR_UNAUTHORIZED = "ArtblocksTraitOracle: UNAUTHORIZED";

    bytes32 constant TYPEHASH_DOMAIN_SEPARATOR =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );
    bytes32 constant DOMAIN_SEPARATOR_NAME_HASH =
        keccak256("ArtblocksTraitOracle");

    /// Art Blocks gives each project a token space of 1 million IDs. Most IDs
    /// in this space are not actually used, but a token's ID floor-divided by
    /// this stride gives the project ID, and the token ID modulo this stride
    /// gives the token index within the project.
    uint256 constant PROJECT_STRIDE = 10**6;

    address public oracleSigner;

    mapping(bytes32 => ProjectInfo) public projectTraitInfo;
    mapping(bytes32 => FeatureInfo) public featureTraitInfo;

    /// Append-only relation on `TraitId * TokenId`, for feature traits only.
    /// (Project trait membership is tracked implicitly through Art Blocks
    /// token IDs.) Encoded by packing 256 token IDs into each word: the
    /// `_tokenId % 256`th bit (counting from the LSB) of
    /// `traitMembers[_traitId][_tokenId / 256]` represents whether `_tokenId`
    /// has trait `_traitId`.
    mapping(bytes32 => mapping(uint256 => uint256)) traitMembers;
    /// Metadata for each feature trait; see struct definition. Not defined for
    /// project traits.
    mapping(bytes32 => FeatureMetadata) traitMetadataMap;

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
        _setProjectInfo(
            _msg.projectId,
            _msg.version,
            _msg.projectName,
            _msg.size
        );
    }

    function _setProjectInfo(
        uint256 _projectId,
        uint256 _version,
        string memory _projectName,
        uint256 _size
    ) internal {
        require(_size > 0, ERR_INVALID_ARGUMENT);
        require(!_stringEmpty(_projectName), ERR_INVALID_ARGUMENT);
        bytes32 _traitId = projectTraitId(_projectId, _version);
        require(projectTraitInfo[_traitId].size == 0, ERR_ALREADY_EXISTS);
        projectTraitInfo[_traitId] = ProjectInfo({
            projectId: _projectId,
            name: _projectName,
            size: _size
        });
        emit ProjectInfoSet({
            traitId: _traitId,
            projectId: _projectId,
            name: _projectName,
            version: _version,
            size: _size
        });
    }

    function setFeatureInfo(
        SetFeatureInfoMessage memory _msg,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) external {
        _requireOracleSignature(_msg.structHash(), _signature, _signatureKind);
        _setFeatureInfo(_msg.projectId, _msg.featureName, _msg.version);
    }

    function _setFeatureInfo(
        uint256 _projectId,
        string memory _featureName,
        uint256 _version
    ) internal {
        require(!_stringEmpty(_featureName), ERR_INVALID_ARGUMENT);
        bytes32 _traitId = featureTraitId(_projectId, _featureName, _version);
        require(
            _stringEmpty(featureTraitInfo[_traitId].name),
            ERR_ALREADY_EXISTS
        );
        featureTraitInfo[_traitId] = FeatureInfo({
            projectId: _projectId,
            name: _featureName
        });
        emit FeatureInfoSet({
            traitId: _traitId,
            projectId: _projectId,
            name: _featureName,
            fullName: _featureName,
            version: _version
        });
    }

    /// Adds tokens as members of a feature trait.
    function addTraitMemberships(
        AddTraitMembershipsMessage memory _msg,
        bytes memory _signature,
        SignatureKind _signatureKind
    ) external {
        bytes32 _structHash = _msg.structHash();
        _requireOracleSignature(_structHash, _signature, _signatureKind);
        _addTraitMemberships(
            _structHash,
            _msg.traitId,
            _msg.words,
            _msg.numTokensFinalized,
            _msg.expectedLastLog
        );
    }

    function _addTraitMemberships(
        bytes32 _structHash,
        bytes32 _traitId,
        TraitMembershipWord[] memory _words,
        uint32 _numTokensFinalized,
        bytes24 _expectedLastLog
    ) internal {
        require(
            !_stringEmpty(featureTraitInfo[_traitId].name),
            ERR_INVALID_ARGUMENT
        );
        FeatureMetadata memory _oldMetadata = traitMetadataMap[_traitId];

        uint32 _newSize = _oldMetadata.currentSize;
        uint32 _newNumFinalized = _oldMetadata.numFinalized;
        if (_numTokensFinalized > _newNumFinalized) {
            _newNumFinalized = _numTokensFinalized;
            require(_oldMetadata.log == _expectedLastLog, ERR_INVALID_STATE);
        }

        for (uint256 _i = 0; _i < _words.length; _i++) {
            TraitMembershipWord memory _word = _words[_i];
            uint256 _oldWord = traitMembers[_traitId][_word.wordIndex];
            uint256 _updates = _word.mask & ~_oldWord;

            // It's an error to update any tokens in this word that are already
            // finalized.
            uint256 _errantUpdates = _updates &
                finalizedTokensMask(_oldMetadata.numFinalized, _word.wordIndex);
            require(_errantUpdates == 0, ERR_IMMUTABLE);

            uint256 _newWord = _oldWord | _updates;

            _newSize += uint32(_updates.popcnt());
            traitMembers[_traitId][_word.wordIndex] = _newWord;
        }

        // If this message didn't add or finalize any new memberships, we don't
        // want to update the hash log *or* emit an event.
        if (
            _newSize == _oldMetadata.currentSize &&
            _newNumFinalized == _oldMetadata.numFinalized
        ) {
            return;
        }

        bytes24 _oldLog = _oldMetadata.log;
        bytes24 _newLog = bytes24(keccak256(abi.encode(_oldLog, _structHash)));

        FeatureMetadata memory _newMetadata = FeatureMetadata({
            currentSize: _newSize,
            numFinalized: _newNumFinalized,
            log: _newLog
        });
        traitMetadataMap[_traitId] = _newMetadata;

        emit TraitUpdated({
            traitId: _traitId,
            newSize: _newSize,
            newNumFinalized: _newNumFinalized,
            newLog: _newLog
        });
    }

    /// Gets the location of the trait membership for the given token ID,
    /// relative to the minimum token ID in its project. For instance, to look
    /// up Archetype #250, call `_tokenBitmask(23000250, 23000000)`.
    ///
    /// The `_inRange` return value is true iff `_tokenId` is within the range
    /// of valid tokens for its project: namely, if `_minTokenId <= _tokenId`
    /// and `_tokenId < _minTokenId + PROJECT_STRIDE`. If `_inRange` is false,
    /// the call is considered unsuccessful, and the other two return values
    /// are to be ignored. The caller may wish to revert.
    ///
    /// For a successful call, the return values `_wordIndex` and `_mask` are
    /// such that `traitMembers[_traitId][_wordIndex] & _mask` isolates the bit
    /// that represents whether token `_tokenId` has trait `_traitId`
    /// (uniformly for all traits).
    function _tokenBitmask(uint256 _tokenId, uint256 _minTokenId)
        internal
        pure
        returns (
            bool _inRange,
            uint256 _wordIndex,
            uint256 _mask
        )
    {
        if (_tokenId < _minTokenId) return (false, 0, 0);
        uint256 _tokenIndex = _tokenId - _minTokenId;
        if (_tokenIndex > PROJECT_STRIDE) return (false, 0, 0);
        _inRange = true;
        _wordIndex = _tokenIndex >> 8;
        _mask = 1 << (_tokenIndex & 0xff);
    }

    function hasTrait(
        IERC721, /*_tokenContract*/
        uint256 _tokenId,
        bytes calldata _trait
    ) external view override returns (bool) {
        bytes32 _traitId = bytes32(_trait);
        // Check project traits first, since this only requires a single
        // storage lookup if `_traitId` represents a feature trait.
        return
            _hasProjectTrait(_tokenId, _traitId) ||
            _hasFeatureTrait(_tokenId, _traitId);
    }

    function _hasProjectTrait(uint256 _tokenId, bytes32 _traitId)
        internal
        view
        returns (bool)
    {
        uint256 _projectSize = projectTraitInfo[_traitId].size;
        if (_projectSize == 0) return false; // gas

        uint256 _tokenProjectId = _tokenId / PROJECT_STRIDE;
        uint256 _traitProjectId = projectTraitInfo[_traitId].projectId;
        if (_tokenProjectId != _traitProjectId) return false;

        uint256 _tokenIndexInProject = _tokenId % PROJECT_STRIDE;
        if (_tokenIndexInProject >= _projectSize) return false;

        return true;
    }

    function _hasFeatureTrait(uint256 _tokenId, bytes32 _traitId)
        internal
        view
        returns (bool)
    {
        // This affirms memberships even for traits that aren't finalized; it's
        // the responsibility of a conscientious frontend to discourage users
        // from making bids on such traits.
        uint256 _projectId = featureTraitInfo[_traitId].projectId;
        uint256 _minTokenId = _projectId * PROJECT_STRIDE;
        (bool _inRange, uint256 _wordIndex, uint256 _mask) = _tokenBitmask(
            _tokenId,
            _minTokenId
        );
        if (!_inRange) return false;
        return traitMembers[_traitId][_wordIndex] & _mask != 0;
    }

    function projectTraitId(uint256 _projectId, uint256 _version)
        public
        pure
        returns (bytes32)
    {
        bytes memory _blob = abi.encode(
            TraitType.PROJECT,
            _projectId,
            _version
        );
        return keccak256(_blob);
    }

    function featureTraitId(
        uint256 _projectId,
        string memory _featureName,
        uint256 _version
    ) public pure returns (bytes32) {
        bytes memory _blob = abi.encode(
            TraitType.FEATURE,
            _projectId,
            _featureName,
            _version
        );
        return keccak256(_blob);
    }

    /// Returns the number of tokens that are currently known to have the given
    /// feature trait.
    function featureMembers(bytes32 _featureTraitId)
        external
        view
        returns (uint256)
    {
        return traitMetadataMap[_featureTraitId].currentSize;
    }

    function traitMetadata(bytes32 _featureTraitId)
        external
        view
        returns (
            uint32 _currentSize,
            uint32 _numFinalized,
            bytes24 _log
        )
    {
        FeatureMetadata memory _meta = traitMetadataMap[_featureTraitId];
        _currentSize = _meta.currentSize;
        _numFinalized = _meta.numFinalized;
        _log = _meta.log;
    }

    /// Dumb helper to test whether a string is empty, because Solidity doesn't
    /// expose `_s.length` for a string `_s`.
    function _stringEmpty(string memory _s) internal pure returns (bool) {
        return bytes(_s).length == 0;
    }

    /// Given that the first `_numFinalized` tokens for trait `_t` have been
    /// finalized, returns a mask into `traitMembers[_t][_wordIndex]` of
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
    function finalizedTokensMask(uint32 _numFinalized, uint256 _wordIndex)
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
