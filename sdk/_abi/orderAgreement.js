module.exports = {
  components: [
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
  ],
  internalType: "struct OrderAgreement",
  name: "agreement",
  type: "tuple",
};
