module.exports = {
  components: [
    { internalType: "uint32", name: "version", type: "uint32" },
    {
      internalType: "contract IERC721",
      name: "tokenContract",
      type: "address",
    },
    { internalType: "uint32", name: "projectId", type: "uint32" },
    { internalType: "string", name: "featureName", type: "string" },
    { internalType: "string", name: "traitValue", type: "string" },
  ],
  internalType: "struct SetFeatureInfoMessage",
  name: "_msg",
  type: "tuple",
};
