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

contract ArtblocksTraitOracle is IERC165, ITraitOracle, Ownable {
    using ArtblocksTraitOracleMessages for SetProjectInfoMessage;
    using ArtblocksTraitOracleMessages for SetFeatureInfoMessage;
    using ArtblocksTraitOracleMessages for AddTraitMembershipsMessage;
    using Popcnt for uint256;

    event OracleSignerChanged(address indexed oracleSigner);
    event ProjectInfoSet(
        uint256 indexed traitId,
        uint256 indexed projectId,
        string name,
        uint256 version,
        uint256 size
    );
    event FeatureInfoSet(
        uint256 indexed traitId,
        uint256 indexed projectId,
        string indexed name,
        string fullName,
        uint256 version
    );
    event TraitMembershipExpanded(uint256 indexed traitId, uint256 newSize);
    event TraitMembershipFinalized(uint256 indexed traitId, uint256 wordIndex);

    string constant ERR_ALREADY_EXISTS = "ArtblocksTraitOracle: ALREADY_EXISTS";
    string constant ERR_IMMUTABLE = "ArtblocksTraitOracle: IMMUTABLE";
    string constant ERR_INVALID_ARGUMENT =
        "ArtblocksTraitOracle: INVALID_ARGUMENT";
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

    mapping(uint256 => ProjectInfo) public projectTraitInfo;
    mapping(uint256 => FeatureInfo) public featureTraitInfo;

    /// Append-only relation on `TraitId * TokenId`, for feature traits only.
    /// (Project trait membership is tracked implicitly through Art Blocks
    /// token IDs.) Encoded by packing 256 token IDs into each word: the
    /// `_tokenId % 256`th bit (counting from the LSB) of
    /// `traitMembers[_traitId][_tokenId / 256]` represents whether `_tokenId`
    /// has trait `_traitId`.
    mapping(uint256 => mapping(uint256 => uint256)) traitMembers;
    /// `traitMembersCount[_traitId]` is the number of distinct `_tokenId`s
    /// that have trait `_traitId`. In terms of encoding, it's the sum of the
    /// population counts of all `traitMembers[_traitId][_]` values.
    mapping(uint256 => uint256) traitMembersCount;
    /// For each trait ID, a set of words in `traitMembers[_]` that are
    /// finalized. Encoded by packing 256 word indices into each word: the
    /// `_wordIndex % 256`th bit (counting form the LSB) of
    /// `traitMembers[_traitId][_wordIndex / 256]` represents whether
    /// `traitMembers[_traitId][_wordIndex]` is finalized. For instance, if
    /// `traitFinalizations[_t][0] == 0x05`, then `traitMembers[_t][0]` and
    /// `traitMembers[_t][2]` are finalized, meaning that the `_t`-membership
    /// statuses of tokens with IDs between 0 and 255 or between 512 and 767
    /// (relative to start of project) are finalized.
    mapping(uint256 => mapping(uint256 => uint256)) traitFinalizations;

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
        uint256 _traitId = projectTraitId(_projectId, _version);
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
        uint256 _traitId = featureTraitId(_projectId, _featureName, _version);
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
        _requireOracleSignature(_msg.structHash(), _signature, _signatureKind);
        _addTraitMemberships(_msg.traitId, _msg.words);
    }

    function _addTraitMemberships(
        uint256 _traitId,
        TraitMembershipWord[] memory _words
    ) internal {
        require(
            !_stringEmpty(featureTraitInfo[_traitId].name),
            ERR_INVALID_ARGUMENT
        );
        uint256 _originalSize = traitMembersCount[_traitId];
        uint256 _newSize = _originalSize;

        for (uint256 _i = 0; _i < _words.length; _i++) {
            TraitMembershipWord memory _word = _words[_i];
            uint256 _oldWord = traitMembers[_traitId][_word.wordIndex];
            uint256 _newWord = _oldWord | _word.mask;
            bool _wasAlreadyFinal = _isFinal(_traitId, _word.wordIndex);
            if (_wasAlreadyFinal) {
                require(_oldWord == _newWord, ERR_IMMUTABLE);
            }
            if (_word.finalized) {
                // If this is the final set, then the given `_word.mask` must
                // cover all the bits set in existing storage.
                require(_newWord == _word.mask, ERR_INVALID_ARGUMENT);
                if (!_wasAlreadyFinal) {
                    emit TraitMembershipFinalized({
                        traitId: _traitId,
                        wordIndex: _word.wordIndex
                    });
                }
                _finalize(_traitId, _word.wordIndex);
            }
            _newSize += (_newWord ^ _oldWord).popcnt();
            traitMembers[_traitId][_word.wordIndex] = _newWord;
        }
        if (_newSize == _originalSize) return;
        traitMembersCount[_traitId] = _newSize;
        emit TraitMembershipExpanded({traitId: _traitId, newSize: _newSize});
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

    /// Marks tokens `_wordIndex * 256` to `_wordIndex * 256 + 255` (relative
    /// to start of project) as finalized for `_traitId`.
    function _finalize(uint256 _traitId, uint256 _wordIndex) internal {
        uint256 _mask = 1 << (_wordIndex & 0xff);
        traitFinalizations[_traitId][_wordIndex >> 8] |= _mask;
    }

    /// Tests whether tokens `_wordIndex * 256` to `_wordIndex * 256 + 255`
    /// (relative to start of project) have been finalized for `_traitId`.
    function _isFinal(uint256 _traitId, uint256 _wordIndex)
        internal
        view
        returns (bool)
    {
        uint256 _mask = 1 << (_wordIndex & 0xff);
        return (traitFinalizations[_traitId][_wordIndex >> 8] & _mask) != 0;
    }

    /// Returns a 256-bit mask whose `_i`th (from LSB) bit is set if tokens
    /// `_start` through `_start + 255` are finalized for feature trait
    /// `_traitId`, where `_start == 256 * (_page * 256 + _i)`, with token IDs
    /// relative to start of project.
    ///
    /// For instance, if `traitMembershipFinalizations(_t, 0) == 0x05`, then
    /// among those tokens with IDs 0 through 65535 (relative to start of
    /// project), the `_t`-membership statuses are finalized for those with IDs
    /// 0 through 255 and 512 through 767.
    function traitMembershipFinalizations(uint256 _traitId, uint256 _page)
        external
        view
        returns (uint256)
    {
        return traitFinalizations[_traitId][_page];
    }

    /// Computes the largest number `_i <= _limit` such that the membership
    /// statuses of tokens `0` (inclusive) through `_i` (exclusive) in feature
    /// trait `_traitId` are finalized. (Token IDs relative to start of
    /// project.)
    ///
    /// If `_traitId` is a feature trait for a project with `_size` total
    /// tokens, then `traitMembershipFinalizedUpTo(_traitId, _size) == _size`
    /// if and only if the relevant memberships are finalized for *all* tokens.
    function traitMembershipFinalizedUpTo(uint256 _traitId, uint256 _limit)
        external
        view
        returns (uint256)
    {
        uint256 _result = 0;
        uint256 _wordIndex = 0;
        uint256 _finalization;
        while (_result < _limit) {
            if (_wordIndex & 0xff == 0) {
                _finalization = traitFinalizations[_traitId][_wordIndex >> 8];
            }
            // Lazy one-bit-at-a-time implementation here instead of using a
            // count-trailing-ones function, just for clarity of correctness
            // and because the gas wastage shouldn't be too high.
            if ((_finalization & (1 << (_wordIndex & 0xff))) != 0) {
                _result += 256;
            } else {
                break;
            }
            _wordIndex++;
        }
        if (_result > _limit) _result = _limit;
        return _result;
    }

    function hasTrait(
        IERC721, /*_tokenContract*/
        uint256 _tokenId,
        bytes calldata _trait
    ) external view override returns (bool) {
        uint256 _traitId = uint256(bytes32(_trait));
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

        uint256 _tokenProjectId = _tokenId / PROJECT_STRIDE;
        uint256 _traitProjectId = projectTraitInfo[_traitId].projectId;
        if (_tokenProjectId != _traitProjectId) return false;

        uint256 _tokenIndexInProject = _tokenId % PROJECT_STRIDE;
        if (_tokenIndexInProject >= _projectSize) return false;

        return true;
    }

    function _hasFeatureTrait(uint256 _tokenId, uint256 _traitId)
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

    /// Returns the number of tokens that are currently known to have the given
    /// feature trait.
    function featureMembers(uint256 _featureTraitId)
        external
        view
        returns (uint256)
    {
        return traitMembersCount[_featureTraitId];
    }

    /// Dumb helper to test whether a string is empty, because Solidity doesn't
    /// expose `_s.length` for a string `_s`.
    function _stringEmpty(string memory _s) internal pure returns (bool) {
        return bytes(_s).length == 0;
    }
}
