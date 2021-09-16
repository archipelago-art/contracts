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

describe("ArtblocksTraitOracle", () => {
  let ArtblocksTraitOracle;
  before(async () => {
    ArtblocksTraitOracle = await ethers.getContractFactory(
      "ArtblocksTraitOracle"
    );
  });

  it("deploys", async () => {
    const oracle = await ArtblocksTraitOracle.deploy();
    await oracle.deployed();
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
      const projectId = 23;
      const version = 0;
      const size = 600;
      const projectName = "Archetype";
      const traitId = projectTraitId(projectId, version);
      await expect(oracle.setProjectInfo(projectId, version, projectName, size))
        .to.emit(oracle, "ProjectInfoSet")
        .withArgs(traitId, projectId, version, size);
      expect(await oracle.projectTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        projectName,
        ethers.BigNumber.from(size),
      ]);
      await expect(
        oracle.setProjectInfo(projectId, version, projectName, size + 1)
      ).to.be.revertedWith(Errors.ALREADY_EXISTS);
    });

    it("for features", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      const projectId = 23;
      const featureName = "Palette: Paddle";
      const version = 0;
      const size = 12;
      const traitId = featureTraitId(projectId, featureName, version);
      await expect(oracle.setFeatureInfo(projectId, featureName, version, size))
        .to.emit(oracle, "FeatureInfoSet")
        .withArgs(traitId, projectId, featureName, version, size);
      expect(await oracle.featureTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        featureName,
        ethers.BigNumber.from(size),
      ]);
      await expect(
        oracle.setFeatureInfo(projectId, featureName, version, size + 1)
      ).to.be.revertedWith(Errors.ALREADY_EXISTS);
    });
  });

  describe("setting trait memberships", () => {
    const projectId = 23;
    const featureName = "Palette: Paddle";
    const version = 0;
    const traitId = featureTraitId(projectId, featureName, version);

    it("updates internal state incrementally", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      const size = 12;
      await oracle.setFeatureInfo(projectId, featureName, version, size);

      const baseTokenId = 23000000;
      const tokenIds = [
        467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314,
      ].map((x) => x + baseTokenId);
      const batch1 = tokenIds.slice(0, 9);
      const batch2 = tokenIds.slice(9);
      expect(batch1.length + batch2.length).to.equal(size);
      const otherTokenId = baseTokenId + 555;
      expect(!tokenIds.includes(otherTokenId));

      await expect(oracle.addTraitMemberships(traitId, batch1))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, batch1.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(false);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(false);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);

      await expect(oracle.addTraitMemberships(traitId, batch2))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, batch1.length + batch2.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);
    });

    it("forbids adding too many members", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      const size = 3;
      await oracle.setFeatureInfo(projectId, featureName, version, size);

      await oracle.addTraitMemberships(traitId, [1, 2]);
      await expect(
        oracle.addTraitMemberships(traitId, [3, 4])
      ).to.be.revertedWith(Errors.INVALID_ARGUMENT);
    });

    it("keeps track of members that were added multiple times", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      const size = 3;
      await oracle.setFeatureInfo(projectId, featureName, version, size);

      await expect(oracle.addTraitMemberships(traitId, [1, 2, 1]))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 2);
      expect(await oracle.hasTrait(1, traitId)).to.be.false;
      await expect(oracle.addTraitMemberships(traitId, [2, 3, 2]))
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 3);
      expect(await oracle.hasTrait(1, traitId)).to.be.true;
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

      await oracle.setProjectInfo(projectId, v0, projectName, size0);
      await oracle.setProjectInfo(projectId, v1, projectName, size1);
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
});
