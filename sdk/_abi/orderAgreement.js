module.exports = {
  components: [
    {
      internalType: "contract IERC20",
      name: "currencyAddress",
      type: "address",
    },
    { internalType: "uint256", name: "price", type: "uint256" },
    { internalType: "contract IERC721", name: "tokenAddress", type: "address" },
    { internalType: "bytes32[]", name: "requiredRoyalties", type: "bytes32[]" },
  ],
  internalType: "struct OrderAgreement",
  name: "agreement",
  type: "tuple",
};
