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
    { internalType: "bytes", name: "trait", type: "bytes" },
    {
      internalType: "contract ITraitOracle",
      name: "traitOracle",
      type: "address",
    },
  ],
  internalType: "struct Bid",
  name: "bid",
  type: "tuple",
};
