// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../ArtblocksRoyaltyOracle.sol";

struct ArtblocksRoyaltyData {
    address artistAddress;
    address additionalPayee;
    uint256 additionalPayeePercentage;
    uint256 royaltyFeeByID;
}

contract TestArtblocksRoyaltyDataSource is IArtblocksRoyaltyDataSource {
    bool artblocksAddressReverts;
    bool getRoyaltyDataReverts;
    address artblocksAddressValue;
    mapping(uint256 => ArtblocksRoyaltyData) public royaltyData;

    string public constant ARTBLOCKS_ADDRESS_REVERT_REASON =
        "TestArtblocksRoyaltyDataSource: artblocksAddress: revert!";
    string public constant GET_ROYALTY_DATA_REVERT_REASON =
        "TestArtblocksRoyaltyDataSource: getRoyaltyData: revert!";

    function set(
        address _artblocksAddress,
        uint256 _tokenId,
        ArtblocksRoyaltyData calldata _royaltyData,
        bool _artblocksAddressReverts,
        bool _getRoyaltyDataReverts
    ) external {
        artblocksAddressValue = _artblocksAddress;
        royaltyData[_tokenId] = _royaltyData;
        artblocksAddressReverts = _artblocksAddressReverts;
        getRoyaltyDataReverts = _getRoyaltyDataReverts;
    }

    function artblocksAddress() external view override returns (address) {
        if (artblocksAddressReverts) revert(ARTBLOCKS_ADDRESS_REVERT_REASON);
        return artblocksAddressValue;
    }

    function getRoyaltyData(uint256 _tokenId)
        external
        view
        override
        returns (
            address artistAddress,
            address additionalPayee,
            uint256 additionalPayeePercentage,
            uint256 royaltyFeeByID
        )
    {
        if (getRoyaltyDataReverts) revert(GET_ROYALTY_DATA_REVERT_REASON);
        ArtblocksRoyaltyData memory _data = royaltyData[_tokenId];
        return (
            _data.artistAddress,
            _data.additionalPayee,
            _data.additionalPayeePercentage,
            _data.royaltyFeeByID
        );
    }
}
