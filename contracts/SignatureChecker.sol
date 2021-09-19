// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

enum SignatureKind {
    /// A message that starts with "\x19Ethereum Signed Message[...]", as
    /// implemented by the `personal_sign` JSON-RPC method.
    ETHEREUM_SIGNED_MESSAGE,
    /// A message that starts with "\x19\x01" and follows the EIP-712 typed
    /// data specification.
    EIP_712
}

library SignatureChecker {
    function recover(
        bytes32 _domainSeparator,
        bytes32 _structHash,
        bytes memory _signature,
        SignatureKind _kind
    ) internal pure returns (address) {
        bytes32 _hash;
        if (_kind == SignatureKind.ETHEREUM_SIGNED_MESSAGE) {
            _hash = ECDSA.toEthSignedMessageHash(
                keccak256(abi.encode(_domainSeparator, _structHash))
            );
        } else {
            _hash = ECDSA.toTypedDataHash(_domainSeparator, _structHash);
        }
        return ECDSA.recover(_hash, _signature);
    }
}