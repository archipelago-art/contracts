module.exports = {
  components: [
    { internalType: "bytes32", name: "agreementHash", type: "bytes32" },
    { internalType: "uint256", name: "nonce", type: "uint256" },
    { internalType: "uint40", name: "deadline", type: "uint40" },
    { internalType: "bytes32[]", name: "extraRoyalties", type: "bytes32[]" },
    { internalType: "uint256", name: "tokenId", type: "uint256" },
    { internalType: "bool", name: "unwrapWeth", type: "bool" },
    { internalType: "address", name: "authorizedBidder", type: "address" },
  ],
  internalType: "struct Ask",
  name: "ask",
  type: "tuple",
};
