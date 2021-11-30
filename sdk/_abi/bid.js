module.exports = {
  components: [
    { internalType: "uint256", name: "nonce", type: "uint256" },
    { internalType: "uint40", name: "deadline", type: "uint40" },
    {
      internalType: "contract IERC20",
      name: "currencyAddress",
      type: "address",
    },
    { internalType: "uint256", name: "price", type: "uint256" },
    { internalType: "contract IERC721", name: "tokenAddress", type: "address" },
    {
      components: [
        { internalType: "address", name: "recipient", type: "address" },
        { internalType: "uint256", name: "micros", type: "uint256" },
      ],
      internalType: "struct Royalty[]",
      name: "requiredRoyalties",
      type: "tuple[]",
    },
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
