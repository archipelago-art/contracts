const ethers = require("ethers");

const { hashLegacyMessage } = require("./signatureChecker");

const TraitType = Object.freeze({
  PROJECT: 0,
  FEATURE: 1,
});

const Errors = Object.freeze({
  ALREADY_EXISTS: "ArtblocksTraitOracle: ALREADY_EXISTS",
  IMMUTABLE: "ArtblocksTraitOracle: IMMUTABLE",
  INVALID_ARGUMENT: "ArtblocksTraitOracle: INVALID_ARGUMENT",
  UNAUTHORIZED: "ArtblocksTraitOracle: UNAUTHORIZED",
  UNAUTHORIZED_OWNERSHIP_TRANSFER: "Ownable: caller is not the owner",
});

const PROJECT_STRIDE = 10 ** 6;

function utf8Hash(s) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
}

function domainSeparator({ oracleAddress, chainId }) {
  return {
    name: "ArtblocksTraitOracle",
    chainId,
    verifyingContract: oracleAddress,
  };
}

function rawDomainSeparator(domainInfo) {
  const type =
    "EIP712Domain(string name,uint256 chainId,address verifyingContract)";
  const { name, chainId, verifyingContract } = domainSeparator(domainInfo);
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "uint256", "address"],
      [utf8Hash(type), utf8Hash(name), chainId, verifyingContract]
    )
  );
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
  { type: "TraitMembershipWord[]", name: "words" },
];
const TraitMembershipWord = [
  { type: "uint256", name: "wordIndex" },
  { type: "uint256", name: "mask" },
  { type: "bool", name: "finalized" },
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
      { AddTraitMembershipsMessage, TraitMembershipWord },
      msg
    );
  },
});

const TYPENAME_TRAIT_MEMBERSHIP_WORD =
  "TraitMembershipWord(uint256 wordIndex,uint256 mask,bool finalized)";
const TYPENAME_SET_PROJECT_INFO =
  "SetProjectInfoMessage(uint256 projectId,uint256 version,string projectName,uint256 size)";
const TYPENAME_SET_FEATURE_INFO =
  "SetFeatureInfoMessage(uint256 projectId,string featureName,uint256 version)";
const TYPENAME_ADD_TRAIT_MEMBERSHIPS =
  "AddTraitMembershipsMessage(uint256 traitId,TraitMembershipWord[] words)";

const TYPEHASH_TRAIT_MEMBERSHIP_WORD = utf8Hash(TYPENAME_TRAIT_MEMBERSHIP_WORD);
const TYPEHASH_SET_PROJECT_INFO = utf8Hash(TYPENAME_SET_PROJECT_INFO);
const TYPEHASH_SET_FEATURE_INFO = utf8Hash(TYPENAME_SET_FEATURE_INFO);
const TYPEHASH_ADD_TRAIT_MEMBERSHIPS = utf8Hash(
  TYPENAME_ADD_TRAIT_MEMBERSHIPS + TYPENAME_TRAIT_MEMBERSHIP_WORD
);

function traitMembershipWordStructHash(word) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "uint256", "bool"],
      [
        TYPEHASH_TRAIT_MEMBERSHIP_WORD,
        word.wordIndex,
        word.mask,
        word.finalized,
      ]
    )
  );
}

function setProjectInfoStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "uint256", "bytes32", "uint256"],
      [
        TYPEHASH_SET_PROJECT_INFO,
        msg.projectId,
        msg.version,
        utf8Hash(msg.projectName),
        msg.size,
      ]
    )
  );
}

function setFeatureInfoStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "bytes32", "uint256"],
      [
        TYPEHASH_SET_FEATURE_INFO,
        msg.projectId,
        utf8Hash(msg.featureName),
        msg.version,
      ]
    )
  );
}

function addTraitMembershipsStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "bytes32"],
      [
        TYPEHASH_ADD_TRAIT_MEMBERSHIPS,
        msg.traitId,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["bytes32[]"],
            [msg.words.map(traitMembershipWordStructHash)]
          )
        ),
      ]
    )
  );
}

async function signLegacyMessage(signer, domainInfo, structHash) {
  const blob = hashLegacyMessage(rawDomainSeparator(domainInfo), structHash);
  return await signer.signMessage(blob);
}

const signLegacy = Object.freeze({
  setProjectInfo(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, setProjectInfoStructHash(msg));
  },
  setFeatureInfo(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, setFeatureInfoStructHash(msg));
  },
  addTraitMemberships(signer, domainInfo, msg) {
    return signLegacyMessage(
      signer,
      domainInfo,
      addTraitMembershipsStructHash(msg)
    );
  },
});

function traitMembershipWords(tokenIds) {
  const relativeIds = tokenIds
    .map((id) => ethers.BigNumber.from(id).mod(PROJECT_STRIDE).toBigInt())
    .sort((a, b) => Number(a - b));
  const wordsByIndex = {};
  for (const id of relativeIds) {
    const idx = id >> 8n;
    wordsByIndex[idx] = wordsByIndex[idx] || { wordIndex: idx, mask: 0n };
    wordsByIndex[idx].mask |= 1n << (id & 0xffn);
  }
  return Object.values(wordsByIndex).map((o) => ({
    wordIndex: ethers.BigNumber.from(o.wordIndex),
    mask: ethers.BigNumber.from(o.mask),
    finalized: false,
  }));
}

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
  signLegacy,
  traitMembershipWords,
  projectTraitId,
  featureTraitId,
};
