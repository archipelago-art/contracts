const ethers = require("ethers");

const { hashLegacyMessage } = require("./signatureChecker");

const TraitType = Object.freeze({
  PROJECT: 0,
  FEATURE: 1,
});

const Errors = Object.freeze({
  ALREADY_EXISTS: "ArtblocksOracle: ALREADY_EXISTS",
  IMMUTABLE: "ArtblocksOracle: IMMUTABLE",
  INVALID_ARGUMENT: "ArtblocksOracle: INVALID_ARGUMENT",
  INVALID_STATE: "ArtblocksOracle: INVALID_STATE",
  UNAUTHORIZED: "ArtblocksOracle: UNAUTHORIZED",
  UNAUTHORIZED_OWNERSHIP_TRANSFER: "Ownable: caller is not the owner",
});

const PROJECT_STRIDE = 10 ** 6;

function utf8Hash(s) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
}

function domainSeparator({ oracleAddress, chainId }) {
  return {
    name: "ArtblocksOracle",
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
  { type: "uint32", name: "version" },
  { type: "address", name: "tokenContract" },
  { type: "uint32", name: "projectId" },
  { type: "uint32", name: "size" },
  { type: "string", name: "projectName" },
];
const SetFeatureInfoMessage = [
  { type: "uint32", name: "version" },
  { type: "address", name: "tokenContract" },
  { type: "uint32", name: "projectId" },
  { type: "string", name: "featureName" },
  { type: "string", name: "traitValue" },
];
const UpdateTraitMessage = [
  { type: "bytes32", name: "traitId" },
  { type: "TraitMembershipWord[]", name: "words" },
  { type: "bytes32", name: "finalization" },
];
const TraitMembershipWord = [
  { type: "uint256", name: "wordIndex" },
  { type: "uint256", name: "mask" },
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
  updateTrait(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { UpdateTraitMessage, TraitMembershipWord },
      msg
    );
  },
});

const TYPENAME_TRAIT_MEMBERSHIP_WORD =
  "TraitMembershipWord(uint256 wordIndex,uint256 mask)";
const TYPENAME_SET_PROJECT_INFO =
  "SetProjectInfoMessage(uint32 version,address tokenContract,uint32 projectId,uint32 size,string projectName)";
const TYPENAME_SET_FEATURE_INFO =
  "SetFeatureInfoMessage(uint32 version,address tokenContract,uint32 projectId,string featureName,string traitValue)";
const TYPENAME_UPDATE_TRAIT =
  "UpdateTraitMessage(bytes32 traitId,TraitMembershipWord[] words,bytes32 finalization)";

const TYPEHASH_TRAIT_MEMBERSHIP_WORD = utf8Hash(TYPENAME_TRAIT_MEMBERSHIP_WORD);
const TYPEHASH_SET_PROJECT_INFO = utf8Hash(TYPENAME_SET_PROJECT_INFO);
const TYPEHASH_SET_FEATURE_INFO = utf8Hash(TYPENAME_SET_FEATURE_INFO);
const TYPEHASH_UPDATE_TRAIT = utf8Hash(
  TYPENAME_UPDATE_TRAIT + TYPENAME_TRAIT_MEMBERSHIP_WORD
);

function traitMembershipWordStructHash(word) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "uint256"],
      [TYPEHASH_TRAIT_MEMBERSHIP_WORD, word.wordIndex, word.mask]
    )
  );
}

function setProjectInfoStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint32", "address", "uint32", "uint32", "bytes32"],
      [
        TYPEHASH_SET_PROJECT_INFO,
        msg.version,
        msg.tokenContract,
        msg.projectId,
        msg.size,
        utf8Hash(msg.projectName),
      ]
    )
  );
}

function setFeatureInfoStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint32", "address", "uint32", "bytes32", "bytes32"],
      [
        TYPEHASH_SET_FEATURE_INFO,
        msg.version,
        msg.tokenContract,
        msg.projectId,
        utf8Hash(msg.featureName),
        utf8Hash(msg.traitValue),
      ]
    )
  );
}

function updateTraitStructHash(msg) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "bytes32"],
      [
        TYPEHASH_UPDATE_TRAIT,
        msg.traitId,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["bytes32[]"],
            [msg.words.map(traitMembershipWordStructHash)]
          )
        ),
        msg.finalization,
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
  updateTrait(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, updateTraitStructHash(msg));
  },
});

const hash = Object.freeze({
  setProjectInfo: setProjectInfoStructHash,
  setFeatureInfo: setFeatureInfoStructHash,
  updateTrait: updateTraitStructHash,
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
  }));
}

function projectTraitId(projectId, version) {
  const blob = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256", "uint256"],
    [TraitType.PROJECT, projectId, version]
  );
  const hash = ethers.utils.keccak256(blob);
  return ethers.utils.hexConcat([
    ethers.utils.hexDataSlice(hash, 0, 31),
    "0x00",
  ]);
}

function featureTraitId(projectId, featureName, traitValue, version) {
  const blob = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "uint256", "string", "string", "uint256"],
    [TraitType.FEATURE, projectId, featureName, traitValue, version]
  );
  const hash = ethers.utils.keccak256(blob);
  return ethers.utils.hexConcat([
    ethers.utils.hexDataSlice(hash, 0, 31),
    "0x01",
  ]);
}

const Bytes24Zero = "0x" + "00".repeat(24);
const INITIAL_TRAIT_LOG = Bytes24Zero;

function updateTraitLog(oldLog = null, msgs) {
  let log = oldLog != null ? oldLog : INITIAL_TRAIT_LOG;
  for (const msg of msgs) {
    const structHash = updateTraitStructHash(msg);
    const hash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes24", "bytes32"],
        [log, structHash]
      )
    );
    log = ethers.utils.hexDataSlice(hash, 0, 24);
  }
  return log;
}

function updateTraitMessage(baseMsg) {
  const msg = { ...baseMsg };
  if (msg.words == null) {
    msg.words = traitMembershipWords(msg.tokenIds);
  }
  delete msg.tokenIds;
  if (msg.finalization == null) {
    const numTokensFinalized = msg.numTokensFinalized || 0;
    const expectedLastLog = msg.expectedLastLog || Bytes24Zero;
    msg.finalization = ethers.utils.solidityPack(
      ["bytes24", "uint32", "uint32"],
      [expectedLastLog, 0 /* padding */, numTokensFinalized]
    );
  }
  delete msg.numTokensFinalized;
  delete msg.expectedLastLog;
  return msg;
}

const abi = Object.freeze({
  SetProjectInfoMessage: require("./_abi/setProjectInfoMessage.js"),
  SetFeatureInfoMessage: require("./_abi/setFeatureInfoMessage.js"),
  UpdateTraitMessage: require("./_abi/updateTraitMessage.js"),
});

module.exports = {
  TraitType,
  Errors,
  PROJECT_STRIDE,
  abi,
  domainSeparator,
  sign712,
  signLegacy,
  traitMembershipWords,
  projectTraitId,
  featureTraitId,
  updateTraitLog,
  INITIAL_TRAIT_LOG,
  updateTraitMessage,
};
