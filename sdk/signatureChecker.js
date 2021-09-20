const SignatureKind = Object.freeze({
  NO_SIGNATURE: 0,
  ETHEREUM_SIGNED_MESSAGE: 1,
  EIP_712: 2,
});

module.exports = { SignatureKind };
