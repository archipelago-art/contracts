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
}

struct AddTraitMembershipsMessage {
    uint256 traitId;
    TraitMembershipWord[] words;
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
    /// If set, the multiple-of-256 block is finalized to exactly the tokens
    /// listed in `mask`; no more tokens may be added later.
    bool finalized;
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
            "AddTraitMembershipsMessage(uint256 traitId,TraitMembershipWord[] words)TraitMembershipWord(uint256 wordIndex,uint256 mask,bool finalized)"
        );
    bytes32 internal constant TYPEHASH_TRAIT_MEMBERSHIP_WORD =
        keccak256(
            "TraitMembershipWord(uint256 wordIndex,uint256 mask,bool finalized)"
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
                    _self.words.structHash()
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
                    _self.mask,
                    _self.finalized
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
