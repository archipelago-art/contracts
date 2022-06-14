module.exports = {
  components: [
    { internalType: "bytes32", name: "traitId", type: "bytes32" },
    {
      components: [
        { internalType: "uint256", name: "wordIndex", type: "uint256" },
        { internalType: "uint256", name: "mask", type: "uint256" },
      ],
      internalType: "struct TraitMembershipWord[]",
      name: "words",
      type: "tuple[]",
    },
    { internalType: "bytes32", name: "finalization", type: "bytes32" },
  ],
  internalType: "struct UpdateTraitMessage",
  name: "_msg",
  type: "tuple",
};
