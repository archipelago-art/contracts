const { expect } = require("chai");
const { ethers } = require("hardhat");

const sdk = require("../sdk");
const {
  SignatureKind,
  artblocks: { TraitType, Errors, PROJECT_STRIDE },
} = sdk;

async function domainInfo(oracleAddress) {
  const chainId = await ethers.provider.send("eth_chainId");
  return { oracleAddress, chainId };
}

async function setProjectInfo(oracle, signer, msg) {
  const domain = await domainInfo(oracle.address);
  const sig = await sdk.artblocks.sign712.setProjectInfo(signer, domain, msg);
  return oracle.setProjectInfo(msg, sig, SignatureKind.EIP_712);
}

async function setFeatureInfo(oracle, signer, msg) {
  const domain = await domainInfo(oracle.address);
  const sig = await sdk.artblocks.sign712.setFeatureInfo(signer, domain, msg);
  return oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712);
}

async function updateTrait(oracle, signer, msg) {
  msg = sdk.artblocks.updateTraitMessage(msg);
  const domain = await domainInfo(oracle.address);
  const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
  return oracle.updateTrait(msg, sig, SignatureKind.EIP_712);
}

describe("ArtblocksOracle", () => {
  let ArtblocksOracle, signers;
  before(async () => {
    ArtblocksOracle = await ethers.getContractFactory("ArtblocksOracle");
    signers = await ethers.getSigners();
  });

  // Arbitrary addresses to use as ERC-721 `tokenContract` fields.
  const TOKEN_0 = ethers.utils.getAddress(
    "0x059edd72cd353df5106d2b9cc5ab83a52287ac3a"
  );
  const TOKEN_1 = ethers.utils.getAddress(
    "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270"
  );

  it("deploys", async () => {
    const oracle = await ArtblocksOracle.deploy();
    await oracle.deployed();
  });

  async function featureSize(oracle, traitId) {
    const [size] = await oracle.featureMetadata(traitId);
    return size;
  }

  describe("EIP-165 `supportsInterface`", async () => {
    let oracle;
    before(async () => {
      oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
    });

    it("accepts the EIP-165 interface", async () => {
      const interfaceId = "0x01ffc9a7";
      expect(await oracle.supportsInterface(interfaceId)).to.equal(true);
    });

    it("accepts the token oracle interface", async () => {
      const interfaceId = ethers.utils.hexDataSlice(
        ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("hasTrait(address,uint256,bytes)")
        ),
        0,
        4
      );
      expect(await oracle.supportsInterface(interfaceId)).to.equal(true);
    });

    it("rejects `bytes4(-1)`", async () => {
      const interfaceId = "0xffffffff";
      expect(await oracle.supportsInterface(interfaceId)).to.equal(false);
    });
  });

  it("permits changing owner", async () => {
    const oracle = await ArtblocksOracle.deploy();
    await oracle.deployed();

    expect(await oracle.owner()).to.equal(signers[0].address);

    await expect(
      oracle.connect(signers[1]).transferOwnership(signers[1].address)
    ).to.be.revertedWith(Errors.UNAUTHORIZED_OWNERSHIP_TRANSFER);

    await expect(
      oracle.connect(signers[0]).transferOwnership(signers[1].address)
    )
      .to.emit(oracle, "OwnershipTransferred")
      .withArgs(signers[0].address, signers[1].address);
    expect(await oracle.owner()).to.equal(signers[1].address);

    await expect(
      oracle.connect(signers[0]).transferOwnership(signers[0].address)
    ).to.be.revertedWith(Errors.UNAUTHORIZED_OWNERSHIP_TRANSFER);

    await expect(
      oracle.connect(signers[1]).transferOwnership(signers[0].address)
    )
      .to.emit(oracle, "OwnershipTransferred")
      .withArgs(signers[1].address, signers[0].address);
    expect(await oracle.owner()).to.equal(signers[0].address);
  });

  describe("computes trait IDs", () => {
    let oracle;
    before(async () => {
      oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
    });

    it("for projects", async () => {
      expect(await oracle.projectTraitId(23, 0)).to.equal(
        sdk.artblocks.projectTraitId(23, 0)
      );
    });

    it("for features", async () => {
      expect(await oracle.featureTraitId(23, "Palette: Paddle", 0)).to.equal(
        sdk.artblocks.featureTraitId(23, "Palette: Paddle", 0)
      );
    });
  });

  describe("accepts non-EIP-712 signed messages", async () => {
    // Internally, this uses `SignatureChecker` (separately tested) everywhere,
    // but we test multiple endpoints to cover the `sdk.artblocks.signLegacy` APIs.
    async function setUp() {
      const signer = signers[1];
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signer.address);
      return { oracle, signer };
    }

    it("for `setProjectInfo`", async () => {
      const { oracle, signer } = await setUp();
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "Archetype",
        size: 600,
        tokenContract: TOKEN_1,
      };
      const sig = await sdk.artblocks.signLegacy.setProjectInfo(
        signer,
        await domainInfo(oracle.address),
        msg
      );
      await expect(
        oracle.setProjectInfo(msg, sig, SignatureKind.ETHEREUM_SIGNED_MESSAGE)
      ).to.emit(oracle, "ProjectInfoSet");
    });

    it("for `setFeatureInfo`", async () => {
      const { oracle, signer } = await setUp();
      const msg = {
        projectId: 23,
        featureName: "Palette: Paddle",
        version: 0,
        tokenContract: TOKEN_1,
      };
      const sig = await sdk.artblocks.signLegacy.setFeatureInfo(
        signer,
        await domainInfo(oracle.address),
        msg
      );
      await expect(
        oracle.setFeatureInfo(msg, sig, SignatureKind.ETHEREUM_SIGNED_MESSAGE)
      ).to.emit(oracle, "FeatureInfoSet");
    });

    it("for `updateTrait`", async () => {
      const { oracle, signer } = await setUp();
      const projectId = 23;
      const baseTokenId = projectId * PROJECT_STRIDE;
      const featureName = "Palette: Paddle";
      const version = 0;
      const traitId = sdk.artblocks.featureTraitId(
        projectId,
        featureName,
        version
      );
      await setFeatureInfo(oracle, signer, {
        projectId,
        featureName,
        version,
        tokenContract: TOKEN_1,
      });
      const msg = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: [baseTokenId, baseTokenId + 1],
      });
      const sig = await sdk.artblocks.signLegacy.updateTrait(
        signer,
        await domainInfo(oracle.address),
        msg
      );
      await expect(
        oracle.updateTrait(msg, sig, SignatureKind.ETHEREUM_SIGNED_MESSAGE)
      ).to.emit(oracle, "TraitUpdated");
    });
  });

  describe("sets trait info exactly once", () => {
    it("for projects", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const projectId = 23;
      const version = 0;
      const size = 600;
      const projectName = "Archetype";
      const traitId = sdk.artblocks.projectTraitId(projectId, version);
      const tokenContract = TOKEN_1;

      const msg1 = { projectId, version, projectName, size, tokenContract };
      await expect(setProjectInfo(oracle, signers[1], msg1))
        .to.emit(oracle, "ProjectInfoSet")
        .withArgs(
          traitId,
          projectId,
          projectName,
          version,
          size,
          tokenContract
        );
      expect(await oracle.projectTraitInfo(traitId)).to.deep.equal([
        tokenContract,
        projectId,
        size,
        projectName,
      ]);

      const msg2 = { ...msg1, size: size + 1 };
      await expect(setProjectInfo(oracle, signers[1], msg2)).to.be.revertedWith(
        Errors.ALREADY_EXISTS
      );
    });

    it("for features", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const projectId = 23;
      const featureName = "Palette: Paddle";
      const version = 0;
      const traitId = sdk.artblocks.featureTraitId(
        projectId,
        featureName,
        version
      );
      const tokenContract = TOKEN_1;

      const msg = { projectId, featureName, version, tokenContract };
      await expect(setFeatureInfo(oracle, signers[1], msg))
        .to.emit(oracle, "FeatureInfoSet")
        .withArgs(
          traitId,
          projectId,
          featureName,
          featureName,
          version,
          tokenContract
        );
      expect(await oracle.featureTraitInfo(traitId)).to.deep.equal([
        tokenContract,
        projectId,
        featureName,
      ]);

      await expect(setFeatureInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.ALREADY_EXISTS
      );
    });
  });

  describe("forbids setting empty trait info", () => {
    it("for null-token projects", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "Archetype",
        size: 600,
        tokenContract: ethers.constants.AddressZero,
      };
      await expect(setProjectInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("for zero-sized projects", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "Archetype",
        size: 0,
        tokenContract: TOKEN_1,
      };
      await expect(setProjectInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("for empty-named projects", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "",
        size: 600,
        tokenContract: TOKEN_1,
      };
      await expect(setProjectInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("for null-token features", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        featureName: "Palette: Paddle",
        version: 0,
        tokenContract: ethers.constants.AddressZero,
      };
      await expect(setFeatureInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("for empty-named features", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        featureName: "",
        version: 0,
        tokenContract: TOKEN_1,
      };
      await expect(setFeatureInfo(oracle, signers[1], msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });
  });

  describe("setting trait memberships", () => {
    const projectId = 23;
    const featureName = "Palette: Paddle";
    const version = 0;
    const baseTokenId = projectId * PROJECT_STRIDE;
    const traitId = sdk.artblocks.featureTraitId(
      projectId,
      featureName,
      version
    );

    async function setUp() {
      const [, admin, signer, nonSigner] = signers;
      const oracle = await ArtblocksOracle.connect(admin).deploy();
      await oracle.deployed();
      await oracle.connect(admin).setOracleSigner(signer.address);
      return { oracle, admin, signer, nonSigner };
    }

    it("updates internal state incrementally", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version, tokenContract: TOKEN_1 };
      expect(await featureSize(oracle, traitId)).to.equal(0);
      await setFeatureInfo(oracle, signer, msg);
      expect(await featureSize(oracle, traitId)).to.equal(0);

      const tokenIds = [
        467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314,
      ].map((x) => x + baseTokenId);
      const batch1 = tokenIds.slice(0, 9);
      const batch2 = tokenIds.slice(9);
      const otherTokenId = baseTokenId + 555;
      expect(!tokenIds.includes(otherTokenId));

      let traitLog = null;
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: batch1,
      });
      traitLog = sdk.artblocks.updateTraitLog(traitLog, [msg1]);
      await expect(updateTrait(oracle, signer, msg1))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, batch1.length, 0, traitLog);
      expect(await oracle.hasTrait(TOKEN_1, batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(TOKEN_1, batch2[0], traitId)).to.equal(
        false
      );
      expect(await oracle.hasTrait(TOKEN_1, otherTokenId, traitId)).to.equal(
        false
      );
      expect(await featureSize(oracle, traitId)).to.equal(batch1.length);

      const msg2 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: batch2,
      });
      traitLog = sdk.artblocks.updateTraitLog(traitLog, [msg2]);
      await expect(await updateTrait(oracle, signer, msg2))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, tokenIds.length, 0, traitLog);
      expect(await oracle.hasTrait(TOKEN_1, batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(TOKEN_1, batch2[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(TOKEN_1, otherTokenId, traitId)).to.equal(
        false
      );
      expect(await featureSize(oracle, traitId)).to.equal(tokenIds.length);
    });

    it("reports non-membership for token IDs out of range", async () => {
      const { oracle, signer } = await setUp();
      const msg1 = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg1);
      const msg2 = { traitId, tokenIds: [baseTokenId + 250] };
      await updateTrait(oracle, signer, msg2);

      expect(
        await oracle.hasTrait(TOKEN_1, baseTokenId + 250, traitId)
      ).to.equal(true);
      expect(await oracle.hasTrait(TOKEN_1, 250, traitId)).to.equal(false);
      expect(
        await oracle.hasTrait(TOKEN_1, 2 * baseTokenId + 250, traitId)
      ).to.equal(false);
    });

    it("reports non-membership for tokens from the wrong token contract", async () => {
      const { oracle, signer } = await setUp();
      const msg1 = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg1);
      const msg2 = { traitId, tokenIds: [baseTokenId + 250] };
      await updateTrait(oracle, signer, msg2);

      expect(
        await oracle.hasTrait(TOKEN_1, baseTokenId + 250, traitId)
      ).to.equal(true);
      expect(
        await oracle.hasTrait(TOKEN_0, baseTokenId + 250, traitId)
      ).to.equal(false);
    });

    it("keeps track of members that were added multiple times", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg);

      let traitLog = null;
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: [baseTokenId + 1, baseTokenId + 2, baseTokenId + 1],
      });
      traitLog = sdk.artblocks.updateTraitLog(traitLog, [msg1]);
      await expect(updateTrait(oracle, signer, msg1))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 2, 0, traitLog);
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 1, traitId)).to.be
        .true;
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 2, traitId)).to.be
        .true;
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 3, traitId)).to.be
        .false;
      expect(await featureSize(oracle, traitId)).to.equal(2);

      const msg2 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: [baseTokenId + 2, baseTokenId + 3, baseTokenId + 2],
      });
      traitLog = sdk.artblocks.updateTraitLog(traitLog, [msg2]);
      await expect(updateTrait(oracle, signer, msg2))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 3, 0, traitLog);
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 1, traitId)).to.be
        .true;
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 2, traitId)).to.be
        .true;
      expect(await oracle.hasTrait(TOKEN_1, baseTokenId + 3, traitId)).to.be
        .true;
      expect(await featureSize(oracle, traitId)).to.equal(3);
    });

    it("rejects assignments to traits that do not exist", async () => {
      const { oracle, signer } = await setUp();
      // Important to use project 0, because that's the default project ID
      // when reading from uninitialized storage.
      const projectId = 0;
      const traitId = sdk.artblocks.featureTraitId(
        projectId,
        featureName,
        version
      );

      const tokenIds = [0, 1];
      const msg = { traitId, tokenIds };
      await expect(updateTrait(oracle, signer, msg)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("permits assignments to project 0", async () => {
      const { oracle, signer } = await setUp();
      const projectId = 0;
      const traitId = sdk.artblocks.featureTraitId(
        projectId,
        featureName,
        version
      );
      const msg = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg);

      const tokenIds = [0, 1];
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds,
      });
      const traitLog = sdk.artblocks.updateTraitLog(null, [msg1]);
      await expect(updateTrait(oracle, signer, msg1))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 2, 0, traitLog);
    });

    it("rejects signatures from unauthorized accounts", async () => {
      const { oracle, signer, nonSigner } = await setUp();
      const msg = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg);

      const msg1 = { traitId, tokenIds: [1, 2, 1] };
      await expect(updateTrait(oracle, nonSigner, msg1)).to.be.revertedWith(
        Errors.UNAUTHORIZED
      );
    });

    it("rejects signatures for other valid messages", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version, tokenContract: TOKEN_1 };
      await setFeatureInfo(oracle, signer, msg);

      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: [1, 2],
      });
      const sig1 = await sdk.artblocks.sign712.updateTrait(
        signer,
        await domainInfo(oracle.address),
        msg1
      );
      const msg2 = sdk.artblocks.updateTraitMessage({
        traitId,
        tokenIds: [3, 4],
      });
      await expect(
        oracle.updateTrait(msg2, sig1, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.UNAUTHORIZED);
    });
  });

  describe("finalizing traits", async () => {
    const projectId = 23;
    const featureName = "Palette: Paddle";
    const version = 0;
    const baseTokenId = projectId * PROJECT_STRIDE;
    const traitId = sdk.artblocks.featureTraitId(
      projectId,
      featureName,
      version
    );

    async function setUp() {
      const [, admin, signer, nonSigner] = signers;
      const oracle = await ArtblocksOracle.connect(admin).deploy();
      await oracle.deployed();
      await oracle.connect(admin).setOracleSigner(signer.address);
      await setFeatureInfo(oracle, signer, {
        projectId,
        featureName,
        version,
        tokenContract: TOKEN_1,
      });
      return { oracle, admin, signer, nonSigner };
    }

    it("allows basic finalization and reverts on later modifications", async () => {
      const { oracle, signer } = await setUp();
      expect(await oracle.featureMetadata(traitId)).to.deep.equal([
        0,
        0,
        sdk.artblocks.INITIAL_TRAIT_LOG,
      ]);
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 0, mask: 0b101 }],
        numTokensFinalized: 256,
        expectedLastLog: sdk.artblocks.INITIAL_TRAIT_LOG,
      });
      const log1 = sdk.artblocks.updateTraitLog(null, [msg1]);
      await expect(updateTrait(oracle, signer, msg1))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 2, 256, log1);
      expect(await oracle.featureMetadata(traitId)).to.deep.equal([
        2,
        256,
        log1,
      ]);

      await expect(
        updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex: 0, mask: 0b111 }],
        })
      ).to.be.revertedWith(Errors.IMMUTABLE);
    });

    it("allows additions after finalization of tokens in lower words", async () => {
      const { oracle, signer } = await setUp();
      const log0 = sdk.artblocks.INITIAL_TRAIT_LOG;
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 0, mask: 0b101 }],
        numTokensFinalized: 256,
        expectedLastLog: log0,
      });
      const log1 = sdk.artblocks.updateTraitLog(log0, [msg1]);
      await updateTrait(oracle, signer, msg1);
      expect(await oracle.featureMetadata(traitId)).to.deep.equal([
        2,
        256,
        log1,
      ]);
      const msg2 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 1, mask: 0b111 }],
      });
      const log2 = sdk.artblocks.updateTraitLog(log1, [msg2]);
      await expect(updateTrait(oracle, signer, msg2))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 5, 256, log2);
      expect(await oracle.featureMetadata(traitId)).to.deep.equal([
        5,
        256,
        log2,
      ]);
    });

    it("permits non-finalizing no-op additions after finalization", async () => {
      const { oracle, signer } = await setUp();
      await updateTrait(oracle, signer, {
        traitId,
        words: [{ wordIndex: 0, mask: 0b111 }],
        numTokensFinalized: 256,
        expectedLastLog: sdk.artblocks.INITIAL_TRAIT_LOG,
      });
      expect(
        await updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex: 0, mask: 0b101 }],
        })
      ).not.to.emit(oracle, "TraitUpdated");
    });

    it("permits finalizing no-op additions after finalization", async () => {
      const { oracle, signer } = await setUp();
      await updateTrait(oracle, signer, {
        traitId,
        words: [{ wordIndex: 0, mask: 0b111 }],
        numTokensFinalized: 256,
        expectedLastLog: sdk.artblocks.INITIAL_TRAIT_LOG,
      });
      expect(
        await updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex: 0, mask: 0b111 }],
          numTokensFinalized: 256,
          // Not the current trait log, but ignored because this is a no-op.
          expectedLastLog: sdk.artblocks.INITIAL_TRAIT_LOG,
        })
      ).not.to.emit(oracle, "TraitUpdated");
    });

    it("may finalize part of a word", async () => {
      const { oracle, signer } = await setUp();
      const log0 = sdk.artblocks.INITIAL_TRAIT_LOG;
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [
          { wordIndex: 0, mask: 0b101 },
          { wordIndex: 1, mask: 0b010 },
        ],
        numTokensFinalized: 259,
        expectedLastLog: log0,
      });
      const log1 = sdk.artblocks.updateTraitLog(log0, [msg1]);
      await expect(updateTrait(oracle, signer, msg1))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 3, 259, log1);
      expect(await oracle.featureMetadata(traitId)).to.deep.equal([
        3,
        259,
        log1,
      ]);

      // Not okay to add memberships in a completely finalized word.
      await expect(
        updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex: 0, mask: 0b1000 }],
        })
      ).to.be.revertedWith(Errors.IMMUTABLE);

      // Not okay to add memberships in the finalized portion of a partially
      // finalized word.
      await expect(
        updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex: 1, mask: 0b0100 }],
        })
      ).to.be.revertedWith(Errors.IMMUTABLE);

      // Okay to add memberships in the unfinalized portion of a partially
      // finalized word.
      const msg2 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 1, mask: 0b1000 }],
      });
      const log2 = sdk.artblocks.updateTraitLog(log1, [msg2]);
      expect(await updateTrait(oracle, signer, msg2))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 4, 259, log2);

      // Okay to add memberships in a completely unfinalized word.
      const msg3 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 2, mask: 0b0001 }],
      });
      const log3 = sdk.artblocks.updateTraitLog(log2, [msg3]);
      expect(await updateTrait(oracle, signer, msg3))
        .to.emit(oracle, "TraitUpdated")
        .withArgs(traitId, 5, 259, log3);
    });

    it("properly finalizes more than 65536 tokens", async () => {
      const { oracle, signer } = await setUp();
      await updateTrait(oracle, signer, {
        traitId,
        words: [
          { wordIndex: 0, mask: 0b101 },
          { wordIndex: 257, mask: 0b010 },
        ],
        numTokensFinalized: 256 * 258 + 2,
      });

      const tests = [
        { wordIndex: 1, mask: 0b1, okay: false },
        { wordIndex: 256, mask: 0b1, okay: false },
        { wordIndex: 257, mask: 0b1, okay: false },
        { wordIndex: 258, mask: 0b1, okay: false },
        { wordIndex: 258, mask: 0b10, okay: false },
        { wordIndex: 258, mask: 0b100, okay: true },
        { wordIndex: 259, mask: 0b1, okay: true },
      ];

      for (const { wordIndex, mask, okay } of tests) {
        const result = updateTrait(oracle, signer, {
          traitId,
          words: [{ wordIndex, mask }],
        });
        if (okay) {
          await expect(result).to.emit(oracle, "TraitUpdated");
        } else {
          await expect(result).to.be.revertedWith(Errors.IMMUTABLE);
        }
      }
    });

    it("rejects finalizations with incorrect trait logs", async () => {
      const { oracle, signer } = await setUp();
      const log0 = sdk.artblocks.INITIAL_TRAIT_LOG;
      const msg1 = sdk.artblocks.updateTraitMessage({
        traitId,
        words: [{ wordIndex: 0, mask: 0b101 }],
        numTokensFinalized: 5,
        expectedLastLog: log0,
      });
      const log1 = sdk.artblocks.updateTraitLog(log0, [msg1]);
      await updateTrait(oracle, signer, msg1);

      await expect(
        updateTrait(oracle, signer, {
          traitId,
          words: [],
          numTokensFinalized: 6,
          expectLastLog: log0, // wrong
        })
      ).to.be.revertedWith(Errors.INVALID_STATE);
    });
  });

  describe("project trait membership testing", async () => {
    let oracle;

    const projectId = 23;
    const v0 = 0;
    const v1 = 1;
    const v2 = 2;
    const size0 = 3; // whoops!
    const size1 = 600;
    const projectName = "Archetype";
    const traitIdV0 = sdk.artblocks.projectTraitId(projectId, v0);
    const traitIdV1 = sdk.artblocks.projectTraitId(projectId, v1);
    const traitIdV2 = sdk.artblocks.projectTraitId(projectId, v2);
    const tokenContract = TOKEN_1;

    const baseId = projectId * PROJECT_STRIDE;

    before(async () => {
      oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);

      const msg0 = {
        projectId,
        version: v0,
        projectName,
        size: size0,
        tokenContract,
      };
      const msg1 = { ...msg0, version: v1, size: size1 };

      await setProjectInfo(oracle, signers[1], msg0);
      await setProjectInfo(oracle, signers[1], msg1);
    });

    it("includes actual members", async () => {
      expect(await oracle.hasTrait(TOKEN_1, baseId, traitIdV0)).to.be.true;
      expect(await oracle.hasTrait(TOKEN_1, baseId, traitIdV1)).to.be.true;
      expect(await oracle.hasTrait(TOKEN_1, baseId + 1, traitIdV0)).to.be.true;
      expect(await oracle.hasTrait(TOKEN_1, baseId + 1, traitIdV1)).to.be.true;
    });

    it("excludes members that are out of range", async () => {
      expect(await oracle.hasTrait(TOKEN_1, baseId + 777, traitIdV0)).to.be
        .false;
      expect(await oracle.hasTrait(TOKEN_1, baseId + 777, traitIdV1)).to.be
        .false;
    });

    it("excludes members from other projects", async () => {
      expect(await oracle.hasTrait(TOKEN_1, baseId + PROJECT_STRIDE, traitIdV0))
        .to.be.false;
    });

    it("excludes members from the wrong token contract", async () => {
      expect(await oracle.hasTrait(TOKEN_0, baseId, traitIdV0)).to.be.false;
    });

    it("determines project size from the correct version", async () => {
      expect(await oracle.hasTrait(TOKEN_1, baseId + 250, traitIdV0)).to.be
        .false;
      expect(await oracle.hasTrait(TOKEN_1, baseId + 250, traitIdV1)).to.be
        .true;
    });

    it("excludes all members from a nonexistent version", async () => {
      expect(await oracle.hasTrait(TOKEN_1, baseId + 250, traitIdV2)).to.be
        .false;
      expect(await oracle.hasTrait(TOKEN_1, baseId, traitIdV2)).to.be.false;
    });
  });

  describe("unknown membership testing", () => {
    it("returns false for a trait with unknown discriminant", async () => {
      const oracle = await ArtblocksOracle.deploy();
      await oracle.deployed();
      const traitId = ethers.utils.defaultAbiCoder.encode(["uint8"], [255]);
      expect(
        await oracle.hasTrait(
          ethers.constants.AddressZero,
          ethers.constants.Zero,
          traitId
        )
      ).to.be.false;
    });
  });
});
