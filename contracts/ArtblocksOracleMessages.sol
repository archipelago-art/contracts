// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

struct SetProjectInfoMessage {
    uint32 version;
    IERC721 tokenContract;
    uint32 projectId;
    uint32 size;
    string projectName;
}

struct SetFeatureInfoMessage {
    uint32 version;
    IERC721 tokenContract;
    uint32 projectId;
    string featureName;
    string traitValue;
}

struct UpdateTraitMessage {
    bytes32 traitId;
    TraitMembershipWord[] words;
    /// Define `numTokensFinalized` as `uint32(uint256(finalization))`
    /// (the low/last 4 bytes) and `expectedLastLog` as `bytes24(finalization)`
    /// (the high/first 24 bytes).
    ///
    /// If `numTokensFinalized` is greater than the current number of tokens
    /// finalized for this trait, then `expectedLastLog` must equal the
    /// previous value of the hash-update log for this trait (not including the
    /// update from this message), and the number of tokens finalized will be
    /// increased to `numTokensFinalized`. If the last log does not match, the
    /// transaction will be reverted.
    ///
    /// If `numTokensFinalized` is *not* greater than the current number of
    /// finalized tokens, then this field and `expectedLastLog` are ignored
    /// (even if the last log does not match). In particular, they are always
    /// ignored when `numTokensFinalized` is zero or if a message is replayed.
    bytes32 finalization;
}

/// A set of token IDs within a multiple-of-256 block.
struct TraitMembershipWord {
    /// This set describes membership for tokens between `wordIndex * 256`
    /// (inclusive) and `(wordIndex + 1) * 256` (exclusive), with IDs relative
    /// to the start of the project.
    uint256 wordIndex;
    /// A 256-bit mask of tokens such that `mask[_i]` is set if token
    /// `wordIndex * 256 + _i` (relative to the start of the project) is in the
    /// set.
    uint256 mask;
}

library ArtblocksOracleMessages {
    using ArtblocksOracleMessages for TraitMembershipWord;
    using ArtblocksOracleMessages for TraitMembershipWord[];

    bytes32 internal constant TYPEHASH_SET_PROJECT_INFO =
        keccak256(
            "SetProjectInfoMessage(uint32 version,address tokenContract,uint32 projectId,uint32 size,string projectName)"
        );
    bytes32 internal constant TYPEHASH_SET_FEATURE_INFO =
        keccak256(
            "SetFeatureInfoMessage(uint32 version,address tokenContract,uint32 projectId,string featureName,string traitValue)"
        );
    bytes32 internal constant TYPEHASH_UPDATE_TRAIT =
        keccak256(
            "UpdateTraitMessage(bytes32 traitId,TraitMembershipWord[] words,bytes32 finalization)TraitMembershipWord(uint256 wordIndex,uint256 mask)"
        );
    bytes32 internal constant TYPEHASH_TRAIT_MEMBERSHIP_WORD =
        keccak256("TraitMembershipWord(uint256 wordIndex,uint256 mask)");

    function structHash(SetProjectInfoMessage memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_SET_PROJECT_INFO,
                    _self.version,
                    _self.tokenContract,
                    _self.projectId,
                    _self.size,
                    keccak256(abi.encodePacked(_self.projectName))
                )
            );
    }

    function structHash(SetFeatureInfoMessage memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_SET_FEATURE_INFO,
                    _self.version,
                    _self.tokenContract,
                    _self.projectId,
                    keccak256(abi.encodePacked(_self.featureName)),
                    keccak256(abi.encodePacked(_self.traitValue))
                )
            );
    }

    function structHash(UpdateTraitMessage memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_UPDATE_TRAIT,
                    _self.traitId,
                    _self.words.structHash(),
                    _self.finalization
                )
            );
    }

    function structHash(TraitMembershipWord memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_TRAIT_MEMBERSHIP_WORD,
                    _self.wordIndex,
                    _self.mask
                )
            );
    }

    function structHash(TraitMembershipWord[] memory _self)
        internal
        pure
        returns (bytes32)
    {
        bytes32[] memory _structHashes = new bytes32[](_self.length);
        for (uint256 _i = 0; _i < _self.length; _i++) {
            _structHashes[_i] = _self[_i].structHash();
        }
        return keccak256(abi.encodePacked(_structHashes));
    }
}
