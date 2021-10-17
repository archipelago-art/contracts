const ethers = require("ethers");

const SignatureKind = Object.freeze({
  NO_SIGNATURE: 0,
  ETHEREUM_SIGNED_MESSAGE: 1,
  EIP_712: 2,
});

function hashLegacyMessage(domainSeparator, structHash) {
  return ethers.utils.arrayify(
    ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32"],
        [domainSeparator, structHash]
      )
    )
  );
}

module.exports = { SignatureKind, hashLegacyMessage };
