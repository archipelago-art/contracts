const { expect } = require("chai");
const { ethers } = require("hardhat");

const TraitType = Object.freeze({
  PROJECT: 0,
  FEATURE: 1,
});

const Errors = Object.freeze({
  ALREADY_EXISTS: "ArtblocksTraitOracle: ALREADY_EXISTS",
  INVALID_ARGUMENT: "ArtblocksTraitOracle: INVALID_ARGUMENT",
  UNAUTHORIZED: "ArtblocksTraitOracle: UNAUTHORIZED",
});

const TOKENS_PER_PROJECT = 10 ** 6;

const DOMAIN_SEPARATOR = Object.freeze({ name: "ArtblocksTraitOracle" });

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

async function signBlob(signer, typeHash, blob) {
  const message = ethers.utils.concat([DOMAIN_SEPARATOR, typeHash, blob]);
  const rawHash = ethers.utils.arrayify(ethers.utils.keccak256(message));
  return await signer.signMessage(rawHash); // implicit EIP-191 prefix
}

async function signSetProjectInfoMessage(signer, msg) {
  return signer._signTypedData(
    DOMAIN_SEPARATOR,
    {
      SetProjectInfoMessage: [
        { type: "uint256", name: "projectId" },
        { type: "uint256", name: "version" },
        { type: "string", name: "projectName" },
        { type: "uint256", name: "size" },
      ],
    },
    msg
  );
}

async function signSetFeatureInfoMessage(signer, msg) {
  return signer._signTypedData(
    DOMAIN_SEPARATOR,
    {
      SetFeatureInfoMessage: [
        { type: "uint256", name: "projectId" },
        { type: "string", name: "featureName" },
        { type: "uint256", name: "version" },
        { type: "uint256", name: "size" },
      ],
    },
    msg
  );
}

async function signAddTraitMembershipsMessage(signer, msg) {
  return signer._signTypedData(
    DOMAIN_SEPARATOR,
    {
      AddTraitMembershipsMessage: [
        { type: "uint256", name: "traitId" },
        { type: "uint256[]", name: "tokenIds" },
      ],
    },
    msg
  );
}

describe("ArtblocksTraitOracle", () => {
  let ArtblocksTraitOracle, signers;
  before(async () => {
    ArtblocksTraitOracle = await ethers.getContractFactory(
      "ArtblocksTraitOracle"
    );
    signers = await ethers.getSigners();
  });

  it("deploys", async () => {
    const oracle = await ArtblocksTraitOracle.deploy();
    await oracle.deployed();
  });

  it("permits changing admin", async () => {
    const oracle = await ArtblocksTraitOracle.deploy();
    await oracle.deployed();

    expect(await oracle.admin()).to.equal(signers[0].address);

    await expect(
      oracle.connect(signers[1]).transferAdmin(signers[1].address)
    ).to.be.revertedWith(Errors.UNAUTHORIZED);

    await expect(oracle.connect(signers[0]).transferAdmin(signers[1].address))
      .to.emit(oracle, "AdminChanged")
      .withArgs(signers[1].address);
    expect(await oracle.admin()).to.equal(signers[1].address);

    await expect(
      oracle.connect(signers[0]).transferAdmin(signers[0].address)
    ).to.be.revertedWith(Errors.UNAUTHORIZED);

    await expect(oracle.connect(signers[1]).transferAdmin(signers[0].address))
      .to.emit(oracle, "AdminChanged")
      .withArgs(signers[0].address);
    expect(await oracle.admin()).to.equal(signers[0].address);
  });

  describe("computes trait IDs", () => {
    let oracle;
    before(async () => {
      oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
    });

    it("for projects", async () => {
      expect(await oracle.projectTraitId(23, 0)).to.equal(
        projectTraitId(23, 0)
      );
    });

    it("for features", async () => {
      expect(await oracle.featureTraitId(23, "Palette: Paddle", 0)).to.equal(
        featureTraitId(23, "Palette: Paddle", 0)
      );
    });
  });

  describe("sets trait info exactly once", () => {
    it("for projects", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const projectId = 23;
      const version = 0;
      const size = 600;
      const projectName = "Archetype";
      const traitId = projectTraitId(projectId, version);

      const msg1 = { projectId, version, projectName, size };
      const sig1 = await signSetProjectInfoMessage(signers[1], msg1);
      await expect(oracle.setProjectInfo(msg1, sig1))
        .to.emit(oracle, "ProjectInfoSet")
        .withArgs(traitId, projectId, version, size);
      expect(await oracle.projectTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        projectName,
        ethers.BigNumber.from(size),
      ]);

      const msg2 = { projectId, version, projectName, size: size + 1 };
      const sig2 = await signSetProjectInfoMessage(signers[1], msg2);
      await expect(oracle.setProjectInfo(msg2, sig2)).to.be.revertedWith(
        Errors.ALREADY_EXISTS
      );
    });

    it("for features", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const projectId = 23;
      const featureName = "Palette: Paddle";
      const version = 0;
      const size = 12;
      const traitId = featureTraitId(projectId, featureName, version);

      const msg1 = { projectId, featureName, version, size };
      const sig1 = await signSetFeatureInfoMessage(signers[1], msg1);
      await expect(oracle.setFeatureInfo(msg1, sig1))
        .to.emit(oracle, "FeatureInfoSet")
        .withArgs(traitId, projectId, featureName, version, size);
      expect(await oracle.featureTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        featureName,
        ethers.BigNumber.from(size),
      ]);

      const msg2 = { projectId, featureName, version, size: size + 1 };
      const sig2 = await signSetFeatureInfoMessage(signers[1], msg2);
      await expect(oracle.setFeatureInfo(msg2, sig2)).to.be.revertedWith(
        Errors.ALREADY_EXISTS
      );
    });
  });

  describe("forbids setting empty trait info", () => {
    it("for projects", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "Archetype",
        size: 0,
      };
      const sig = await signSetProjectInfoMessage(signers[1], msg);
      await expect(oracle.setProjectInfo(msg, sig)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("for features", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        featureName: "Palette: Paddle",
        version: 0,
        size: 0,
      };
      const sig = await signSetFeatureInfoMessage(signers[1], msg);
      await expect(oracle.setFeatureInfo(msg, sig)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });
  });

  describe("setting trait memberships", () => {
    const projectId = 23;
    const featureName = "Palette: Paddle";
    const version = 0;
    const traitId = featureTraitId(projectId, featureName, version);

    async function setUp() {
      const [, admin, signer, nonSigner] = signers;
      const oracle = await ArtblocksTraitOracle.connect(admin).deploy();
      await oracle.deployed();
      await oracle.connect(admin).setOracleSigner(signer.address);
      return { oracle, admin, signer, nonSigner };
    }

    it("updates internal state incrementally", async () => {
      const { oracle, signer } = await setUp();
      const size = 12;
      const msg = { projectId, featureName, version, size };
      const sig = await signSetFeatureInfoMessage(signer, msg);
      expect(await oracle.isFeatureFinalized(traitId)).to.equal(false);
      await oracle.setFeatureInfo(msg, sig);
      expect(await oracle.isFeatureFinalized(traitId)).to.equal(false);

      const baseTokenId = 23000000;
      const tokenIds = [
        467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314,
      ].map((x) => x + baseTokenId);
      const batch1 = tokenIds.slice(0, 9);
      const batch2 = tokenIds.slice(9);
      expect(batch1.length + batch2.length).to.equal(size);
      const otherTokenId = baseTokenId + 555;
      expect(!tokenIds.includes(otherTokenId));

      const msg1 = { traitId, tokenIds: batch1 };
      const sig1 = await signAddTraitMembershipsMessage(signer, msg1);
      await expect(oracle.addTraitMemberships(msg1, sig1))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, batch1.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(false);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);
      expect(await oracle.isFeatureFinalized(traitId)).to.equal(false);

      const msg2 = { traitId, tokenIds: batch2 };
      const sig2 = await signAddTraitMembershipsMessage(signer, msg2);
      await expect(oracle.addTraitMemberships(msg2, sig2))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, batch1.length + batch2.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);
      expect(await oracle.isFeatureFinalized(traitId)).to.equal(true);
    });

    it("forbids adding too many members", async () => {
      const { oracle, signer } = await setUp();
      const size = 3;
      const msg = { projectId, featureName, version, size };
      const sig = await signSetFeatureInfoMessage(signer, msg);
      await oracle.setFeatureInfo(msg, sig);

      const msg1 = { traitId, tokenIds: [1, 2] };
      const sig1 = await signAddTraitMembershipsMessage(signer, msg1);
      await oracle.addTraitMemberships(msg1, sig1);

      const msg2 = { traitId, tokenIds: [3, 4] };
      const sig2 = await signAddTraitMembershipsMessage(signer, msg2);
      await expect(oracle.addTraitMemberships(msg2, sig2)).to.be.revertedWith(
        Errors.INVALID_ARGUMENT
      );
    });

    it("keeps track of members that were added multiple times", async () => {
      const { oracle, signer } = await setUp();
      const size = 3;
      const msg = { projectId, featureName, version, size };
      const sig = await signSetFeatureInfoMessage(signer, msg);
      await oracle.setFeatureInfo(msg, sig);

      const msg1 = { traitId, tokenIds: [1, 2, 1] };
      const sig1 = await signAddTraitMembershipsMessage(signer, msg1);
      await expect(oracle.addTraitMemberships(msg1, sig1))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 2);
      expect(await oracle.hasTrait(1, traitId)).to.be.true;
      expect(await oracle.hasTrait(2, traitId)).to.be.true;
      expect(await oracle.hasTrait(3, traitId)).to.be.false;
      expect(await oracle.isFeatureFinalized(traitId)).to.be.false;

      const msg2 = { traitId, tokenIds: [2, 3, 2] };
      const sig2 = await signAddTraitMembershipsMessage(signer, msg2);
      await expect(oracle.addTraitMemberships(msg2, sig2))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 3);
      expect(await oracle.hasTrait(1, traitId)).to.be.true;
      expect(await oracle.hasTrait(2, traitId)).to.be.true;
      expect(await oracle.hasTrait(3, traitId)).to.be.true;
      expect(await oracle.isFeatureFinalized(traitId)).to.be.true;
    });

    it("rejects signatures from unauthorized accounts", async () => {
      const { oracle, signer, nonSigner } = await setUp();
      const msg = { projectId, featureName, version, size: 600 };
      const sig = await signSetFeatureInfoMessage(signer, msg);
      await oracle.setFeatureInfo(msg, sig);

      const msg1 = { traitId, tokenIds: [1, 2, 1] };
      const sig1 = await signAddTraitMembershipsMessage(nonSigner, msg1);
      await expect(oracle.addTraitMemberships(msg1, sig1)).to.be.revertedWith(
        Errors.UNAUTHORIZED
      );
    });

    it("rejects signatures for other valid messages", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version, size: 600 };
      const sig = await signSetFeatureInfoMessage(signer, msg);
      await oracle.setFeatureInfo(msg, sig);

      const msg1 = { traitId, tokenIds: [1, 2] };
      const sig1 = await signAddTraitMembershipsMessage(signer, msg1);
      const msg2 = { traitId, tokenIds: [3, 4] };
      await expect(oracle.addTraitMemberships(msg2, sig1)).to.be.revertedWith(
        Errors.UNAUTHORIZED
      );
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
    const traitIdV0 = projectTraitId(projectId, v0);
    const traitIdV1 = projectTraitId(projectId, v1);
    const traitIdV2 = projectTraitId(projectId, v2);

    const baseId = projectId * TOKENS_PER_PROJECT;

    before(async () => {
      oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);

      const msg0 = { projectId, version: v0, projectName, size: size0 };
      const msg1 = { projectId, version: v1, projectName, size: size1 };

      const sig0 = await signSetProjectInfoMessage(signers[1], msg0);
      const sig1 = await signSetProjectInfoMessage(signers[1], msg1);

      await oracle.setProjectInfo(msg0, sig0);
      await oracle.setProjectInfo(msg1, sig1);
    });

    it("includes actual members", async () => {
      expect(await oracle.hasTrait(baseId, traitIdV0)).to.be.true;
      expect(await oracle.hasTrait(baseId, traitIdV1)).to.be.true;
      expect(await oracle.hasTrait(baseId + 1, traitIdV0)).to.be.true;
      expect(await oracle.hasTrait(baseId + 1, traitIdV1)).to.be.true;
    });

    it("excludes members that are out of range", async () => {
      expect(await oracle.hasTrait(baseId + 777, traitIdV0)).to.be.false;
      expect(await oracle.hasTrait(baseId + 777, traitIdV1)).to.be.false;
    });

    it("determines project size from the correct version", async () => {
      expect(await oracle.hasTrait(baseId + 250, traitIdV0)).to.be.false;
      expect(await oracle.hasTrait(baseId + 250, traitIdV1)).to.be.true;
    });

    it("excludes all members from a nonexistent version", async () => {
      expect(await oracle.hasTrait(baseId + 250, traitIdV2)).to.be.false;
      expect(await oracle.hasTrait(baseId, traitIdV2)).to.be.false;
    });
  });

  it("does not admit signature collisions", async () => {
    // These two messages have the same ABI encoding, but different signatures
    // because their type hashes are different.
    const msg1 = { projectId: 0, version: 0x80, projectName: "", size: 0 };
    const msg2 = { projectId: 0, featureName: "", version: 0x80, size: 0 };
    expect(msg1).to.not.deep.equal(msg2);

    const sig1 = await signSetProjectInfoMessage(signers[0], msg1);
    const sig2 = await signSetFeatureInfoMessage(signers[0], msg2);
    expect(sig1).not.to.equal(sig2);
  });
});
