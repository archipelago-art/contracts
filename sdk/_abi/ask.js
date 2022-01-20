module.exports = {
  components: [
    { internalType: "bytes32", name: "agreementHash", type: "bytes32" },
    { internalType: "uint256", name: "nonce", type: "uint256" },
    { internalType: "uint40", name: "deadline", type: "uint40" },
    {
      components: [
        { internalType: "address", name: "recipient", type: "address" },
        { internalType: "uint256", name: "micros", type: "uint256" },
      ],
      internalType: "struct Royalty[]",
      name: "extraRoyalties",
      type: "tuple[]",
    },
    { internalType: "uint256", name: "tokenId", type: "uint256" },
    { internalType: "bool", name: "unwrapWeth", type: "bool" },
    { internalType: "address", name: "authorizedBidder", type: "address" },
  ],
  internalType: "struct Ask",
  name: "ask",
  type: "tuple",
};
