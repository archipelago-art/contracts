// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./ArtblocksRoyaltyOracle.sol";
import "./IRoyaltyOracle.sol";

/// Upstream royalty data interface implemented by Powered by Art Blocks
/// contracts: e.g., the following on mainnet:
///
///   - 0x0A1BBD57033F57E7B6743621b79fCB9Eb2CE3676: Bright Moments
///   - 0x64780CE53f6e966E18a22Af13a2F97369580Ec11: Art Blocks x PACE
interface IPbabRoyaltyDataSource {
    function renderProviderAddress() external view returns (address);

    function getRoyaltyData(uint256 _tokenId)
        external
        view
        returns (
            address artistAddress,
            address additionalPayee,
            uint256 additionalPayeePercentage,
            uint256 royaltyFeeByID
        );
}

contract PbabRoyaltyOracle is IRoyaltyOracle, ArtblocksRoyaltyOracle {
    function _getArtblocksAddress(address _dataSource)
        internal
        view
        override
        returns (address)
    {
        try
            IPbabRoyaltyDataSource(_dataSource).renderProviderAddress()
        returns (address _result) {
            return _result;
        } catch {
            return address(0);
        }
    }
}
