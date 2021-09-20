const ethers = require("ethers");

const TraitType = Object.freeze({
  PROJECT: 0,
  FEATURE: 1,
});

const Errors = Object.freeze({
  ALREADY_EXISTS: "ArtblocksTraitOracle: ALREADY_EXISTS",
  INVALID_ARGUMENT: "ArtblocksTraitOracle: INVALID_ARGUMENT",
  UNAUTHORIZED: "ArtblocksTraitOracle: UNAUTHORIZED",
});

const PROJECT_STRIDE = 10 ** 6;

function domainSeparator({ oracleAddress, chainId }) {
  return {
    name: "ArtblocksTraitOracle",
    chainId,
    verifyingContract: oracleAddress,
  };
}

const SetProjectInfoMessage = [
  { type: "uint256", name: "projectId" },
  { type: "uint256", name: "version" },
  { type: "string", name: "projectName" },
  { type: "uint256", name: "size" },
];
const SetFeatureInfoMessage = [
  { type: "uint256", name: "projectId" },
  { type: "string", name: "featureName" },
  { type: "uint256", name: "version" },
];
const AddTraitMembershipsMessage = [
  { type: "uint256", name: "traitId" },
  { type: "uint256[]", name: "tokenIds" },
];

const sign712 = Object.freeze({
  setProjectInfo(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { SetProjectInfoMessage },
      msg
    );
  },
  setFeatureInfo(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { SetFeatureInfoMessage },
      msg
    );
  },
  addTraitMemberships(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { AddTraitMembershipsMessage },
      msg
    );
  },
});

function projectTraitId(projectId, version) {
  const blob = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256", "uint256"],
    [TraitType.PROJECT, projectId, version]
  );
  return ethers.utils.keccak256(blob);
}

function featureTraitId(projectId, featureName, version) {
  const blob = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256", "string", "uint256"],
    [TraitType.FEATURE, projectId, featureName, version]
  );
  return ethers.utils.keccak256(blob);
}

module.exports = {
  TraitType,
  Errors,
  PROJECT_STRIDE,
  domainSeparator,
  sign712,
  projectTraitId,
  featureTraitId,
};
