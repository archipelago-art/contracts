// SPDX-License-Identifier: UNLICENSED
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
}

struct AddTraitMembershipsMessage {
    uint256 traitId;
    TraitMembershipWord[] words;
    /// If `numTokensFinalized` is greater than the current number of tokens
    /// finalized for this trait, then `expectedLastLog` must equal the
    /// previous value of the hash-update log for this trait (not including the
    /// update from this message), and the number of tokens finalized will be
    /// increased to `numTokensFinalized`. If the last log does not match, this
    ///
    /// If `numTokensFinalized` is *not* greater than the current number of
    /// finalized tokens, then this field and `expectedLastLog` are ignored
    /// (even if the last log does not match). In particular, they are always
    /// ignored when `numTokensFinalized` is zero or if a message is replayed.
    uint32 numTokensFinalized;
    bytes24 expectedLastLog;
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

library ArtblocksTraitOracleMessages {
    using ArtblocksTraitOracleMessages for TraitMembershipWord;
    using ArtblocksTraitOracleMessages for TraitMembershipWord[];

    bytes32 internal constant TYPEHASH_SET_PROJECT_INFO =
        keccak256(
            "SetProjectInfoMessage(uint256 projectId,uint256 version,string projectName,uint256 size)"
        );
    bytes32 internal constant TYPEHASH_SET_FEATURE_INFO =
        keccak256(
            "SetFeatureInfoMessage(uint256 projectId,string featureName,uint256 version)"
        );
    bytes32 internal constant TYPEHASH_ADD_TRAIT_MEMBERSHIPS =
        keccak256(
            "AddTraitMembershipsMessage(uint256 traitId,TraitMembershipWord[] words,uint32 numTokensFinalized,bytes24 expectedLastLog)TraitMembershipWord(uint256 wordIndex,uint256 mask)"
        );
    bytes32 internal constant TYPEHASH_TRAIT_MEMBERSHIP_WORD =
        keccak256(
            "TraitMembershipWord(uint256 wordIndex,uint256 mask)"
        );

    function structHash(SetProjectInfoMessage memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encodePacked(
                    TYPEHASH_SET_PROJECT_INFO,
                    _self.projectId,
                    _self.version,
                    keccak256(abi.encodePacked(_self.projectName)),
                    _self.size
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
                abi.encodePacked(
                    TYPEHASH_SET_FEATURE_INFO,
                    _self.projectId,
                    keccak256(abi.encodePacked(_self.featureName)),
                    _self.version
                )
            );
    }

    function structHash(AddTraitMembershipsMessage memory _self)
        internal
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encodePacked(
                    TYPEHASH_ADD_TRAIT_MEMBERSHIPS,
                    _self.traitId,
                    _self.words.structHash(),
                    uint256(_self.numTokensFinalized),
                    bytes32(_self.expectedLastLog)
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
