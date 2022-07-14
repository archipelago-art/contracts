// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../PbabRoyaltyOracle.sol";

struct ArtblocksRoyaltyData {
    address artistAddress;
    address additionalPayee;
    uint256 additionalPayeePercentage;
    uint256 royaltyFeeByID;
}

contract TestPbabRoyaltyDataSource is IPbabRoyaltyDataSource {
    bool renderProviderAddressReverts;
    bool getRoyaltyDataReverts;
    address renderProviderAddressValue;
    mapping(uint256 => ArtblocksRoyaltyData) public royaltyData;

    string public constant ARTBLOCKS_ADDRESS_REVERT_REASON =
        "TestArtblocksRoyaltyDataSource: renderProviderAddress: revert!";
    string public constant GET_ROYALTY_DATA_REVERT_REASON =
        "TestArtblocksRoyaltyDataSource: getRoyaltyData: revert!";

    function set(
        address _renderProviderAddress,
        uint256 _tokenId,
        ArtblocksRoyaltyData calldata _royaltyData,
        bool _renderProviderAddressReverts,
        bool _getRoyaltyDataReverts
    ) external {
        renderProviderAddressValue = _renderProviderAddress;
        royaltyData[_tokenId] = _royaltyData;
        renderProviderAddressReverts = _renderProviderAddressReverts;
        getRoyaltyDataReverts = _getRoyaltyDataReverts;
    }

    function renderProviderAddress() external view override returns (address) {
        if (renderProviderAddressReverts)
            revert(ARTBLOCKS_ADDRESS_REVERT_REASON);
        return renderProviderAddressValue;
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
