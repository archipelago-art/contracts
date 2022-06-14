module.exports = {
  components: [
    { internalType: "uint32", name: "version", type: "uint32" },
    {
      internalType: "contract IERC721",
      name: "tokenContract",
      type: "address",
    },
    { internalType: "uint32", name: "projectId", type: "uint32" },
    { internalType: "uint32", name: "size", type: "uint32" },
    { internalType: "string", name: "projectName", type: "string" },
  ],
  internalType: "struct SetProjectInfoMessage",
  name: "_msg",
  type: "tuple",
};
