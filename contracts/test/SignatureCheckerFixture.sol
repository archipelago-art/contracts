// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../SignatureChecker.sol";

contract SignatureCheckerFixture {
    function recover(
        bytes32 _domainSeparator,
        bytes32 _structHash,
        bytes memory _signature,
        SignatureKind _kind
    ) external pure returns (address) {
        return
            SignatureChecker.recover(
                _domainSeparator,
                _structHash,
                _signature,
                _kind
            );
    }
}
