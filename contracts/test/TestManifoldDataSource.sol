// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../IManifold.sol";

struct ManifoldRoyalties {
    address payable[] recipients;
    uint256[] bps;
}

contract TestManifoldDataSource is IManifold {
    ManifoldRoyalties result;
    uint256 expectedTokenId;
    bool reverts;

    string public constant REVERT_REASON = "TestManifoldDataSource: revert!";
    string public constant WRONG_TOKEN_ID_REASON =
        "TestManifoldDataSource: wrong token ID!";

    function set(
        ManifoldRoyalties calldata _result,
        uint256 _expectedTokenId,
        bool _reverts
    ) external {
        result = _result;
        expectedTokenId = _expectedTokenId;
        reverts = _reverts;
    }

    function getRoyalties(uint256 _tokenId)
        external
        view
        override
        returns (address payable[] memory recipients, uint256[] memory bps)
    {
        if (reverts) revert(REVERT_REASON);
        if (_tokenId != expectedTokenId) revert(WRONG_TOKEN_ID_REASON);
        ManifoldRoyalties memory _result = result;
        return (_result.recipients, _result.bps);
    }
}
