const { expect } = require("chai");
const { ethers } = require("hardhat");

const sdk = require("../sdk");
const {
  SignatureKind,
  oracle: { TraitType, Errors, PROJECT_STRIDE },
} = sdk;

const RAW_DOMAIN_SEPARATOR = ethers.utils.keccak256(
  ethers.utils.concat([
    ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("EIP712Domain(string name)")
    ),
    ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(sdk.oracle.DOMAIN_SEPARATOR.name)
    ),
  ])
);

async function signSetProjectInfoLegacy(signer, msg) {
  const typeHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
      "SetProjectInfoMessage(uint256 projectId,uint256 version,string projectName,uint256 size)"
    )
  );
  const structHash = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "uint256", "uint256", "bytes32", "uint256"],
      [
        typeHash,
        msg.projectId,
        msg.version,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(msg.projectName)),
        msg.size,
      ]
    )
  );
  const message = ethers.utils.arrayify(
    ethers.utils.keccak256(
      ethers.utils.concat([RAW_DOMAIN_SEPARATOR, structHash])
    )
  );
  return signer.signMessage(message);
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
        sdk.oracle.projectTraitId(23, 0)
      );
    });

    it("for features", async () => {
      expect(await oracle.featureTraitId(23, "Palette: Paddle", 0)).to.equal(
        sdk.oracle.featureTraitId(23, "Palette: Paddle", 0)
      );
    });
  });

  it("accepts non-EIP-712 signed messages", async () => {
    // Internally, this uses `SignatureChecker` (separately tested) everywhere,
    // so just smoke-test one of the endpoints.
    const oracle = await ArtblocksTraitOracle.deploy();
    await oracle.deployed();
    await oracle.setOracleSigner(signers[1].address);
    const msg = {
      projectId: 23,
      version: 0,
      projectName: "Archetype",
      size: 600,
    };
    const sig = await signSetProjectInfoLegacy(signers[1], msg);
    await expect(
      oracle.setProjectInfo(msg, sig, SignatureKind.ETHEREUM_SIGNED_MESSAGE)
    ).to.emit(oracle, "ProjectInfoSet");
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
      const traitId = sdk.oracle.projectTraitId(projectId, version);

      const msg1 = { projectId, version, projectName, size };
      const sig1 = await sdk.oracle.sign712.setProjectInfo(signers[1], msg1);
      await expect(oracle.setProjectInfo(msg1, sig1, SignatureKind.EIP_712))
        .to.emit(oracle, "ProjectInfoSet")
        .withArgs(traitId, projectId, projectName, version, size);
      expect(await oracle.projectTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        projectName,
        ethers.BigNumber.from(size),
      ]);

      const msg2 = { projectId, version, projectName, size: size + 1 };
      const sig2 = await sdk.oracle.sign712.setProjectInfo(signers[1], msg2);
      await expect(
        oracle.setProjectInfo(msg2, sig2, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.ALREADY_EXISTS);
    });

    it("for features", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const projectId = 23;
      const featureName = "Palette: Paddle";
      const version = 0;
      const traitId = sdk.oracle.featureTraitId(
        projectId,
        featureName,
        version
      );

      const msg = { projectId, featureName, version };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signers[1], msg);
      await expect(oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712))
        .to.emit(oracle, "FeatureInfoSet")
        .withArgs(traitId, projectId, featureName, featureName, version);
      expect(await oracle.featureTraitInfo(traitId)).to.deep.equal([
        ethers.BigNumber.from(projectId),
        featureName,
      ]);

      await expect(
        oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.ALREADY_EXISTS);
    });
  });

  describe("forbids setting empty trait info", () => {
    it("for zero-sized projects", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "Archetype",
        size: 0,
      };
      const sig = await sdk.oracle.sign712.setProjectInfo(signers[1], msg);
      await expect(
        oracle.setProjectInfo(msg, sig, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.INVALID_ARGUMENT);
    });

    it("for empty-named projects", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        version: 0,
        projectName: "",
        size: 600,
      };
      const sig = await sdk.oracle.sign712.setProjectInfo(signers[1], msg);
      await expect(
        oracle.setProjectInfo(msg, sig, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.INVALID_ARGUMENT);
    });

    it("for empty-named features", async () => {
      const oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);
      const msg = {
        projectId: 23,
        featureName: "",
        version: 0,
      };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signers[1], msg);
      await expect(
        oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.INVALID_ARGUMENT);
    });
  });

  describe("setting trait memberships", () => {
    const projectId = 23;
    const featureName = "Palette: Paddle";
    const version = 0;
    const baseTokenId = projectId * PROJECT_STRIDE;
    const traitId = sdk.oracle.featureTraitId(projectId, featureName, version);

    async function setUp() {
      const [, admin, signer, nonSigner] = signers;
      const oracle = await ArtblocksTraitOracle.connect(admin).deploy();
      await oracle.deployed();
      await oracle.connect(admin).setOracleSigner(signer.address);
      return { oracle, admin, signer, nonSigner };
    }

    it("updates internal state incrementally", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signer, msg);
      expect(await oracle.featureMembers(traitId)).to.equal(0);
      await oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712);
      expect(await oracle.featureMembers(traitId)).to.equal(0);

      const tokenIds = [
        467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314,
      ].map((x) => x + baseTokenId);
      const batch1 = tokenIds.slice(0, 9);
      const batch2 = tokenIds.slice(9);
      const otherTokenId = baseTokenId + 555;
      expect(!tokenIds.includes(otherTokenId));

      const msg1 = { traitId, tokenIds: batch1 };
      const sig1 = await sdk.oracle.sign712.addTraitMemberships(signer, msg1);
      await expect(
        oracle.addTraitMemberships(msg1, sig1, SignatureKind.EIP_712)
      )
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, batch1.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(false);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);
      expect(await oracle.featureMembers(traitId)).to.equal(batch1.length);

      const msg2 = { traitId, tokenIds: batch2 };
      const sig2 = await sdk.oracle.sign712.addTraitMemberships(signer, msg2);
      await expect(
        oracle.addTraitMemberships(msg2, sig2, SignatureKind.EIP_712)
      )
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, tokenIds.length);
      expect(await oracle.hasTrait(batch1[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(batch2[0], traitId)).to.equal(true);
      expect(await oracle.hasTrait(otherTokenId, traitId)).to.equal(false);
      expect(await oracle.featureMembers(traitId)).to.equal(tokenIds.length);
    });

    it("keeps track of members that were added multiple times", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signer, msg);
      await oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712);

      const msg1 = {
        traitId,
        tokenIds: [baseTokenId + 1, baseTokenId + 2, baseTokenId + 1],
      };
      const sig1 = await sdk.oracle.sign712.addTraitMemberships(signer, msg1);
      await expect(
        oracle.addTraitMemberships(msg1, sig1, SignatureKind.EIP_712)
      )
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 2);
      expect(await oracle.hasTrait(baseTokenId + 1, traitId)).to.be.true;
      expect(await oracle.hasTrait(baseTokenId + 2, traitId)).to.be.true;
      expect(await oracle.hasTrait(baseTokenId + 3, traitId)).to.be.false;
      expect(await oracle.featureMembers(traitId)).to.equal(2);

      const msg2 = {
        traitId,
        tokenIds: [baseTokenId + 2, baseTokenId + 3, baseTokenId + 2],
      };
      const sig2 = await sdk.oracle.sign712.addTraitMemberships(signer, msg2);
      await expect(
        oracle.addTraitMemberships(msg2, sig2, SignatureKind.EIP_712)
      )
        .to.emit(oracle, "TraitMembershipExpanded")
        .withArgs(traitId, 3);
      expect(await oracle.hasTrait(baseTokenId + 1, traitId)).to.be.true;
      expect(await oracle.hasTrait(baseTokenId + 2, traitId)).to.be.true;
      expect(await oracle.hasTrait(baseTokenId + 3, traitId)).to.be.true;
      expect(await oracle.featureMembers(traitId)).to.equal(3);
    });

    it("rejects signatures from unauthorized accounts", async () => {
      const { oracle, signer, nonSigner } = await setUp();
      const msg = { projectId, featureName, version };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signer, msg);
      await oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712);

      const msg1 = { traitId, tokenIds: [1, 2, 1] };
      const sig1 = await sdk.oracle.sign712.addTraitMemberships(
        nonSigner,
        msg1
      );
      await expect(
        oracle.addTraitMemberships(msg1, sig1, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.UNAUTHORIZED);
    });

    it("rejects signatures for other valid messages", async () => {
      const { oracle, signer } = await setUp();
      const msg = { projectId, featureName, version };
      const sig = await sdk.oracle.sign712.setFeatureInfo(signer, msg);
      await oracle.setFeatureInfo(msg, sig, SignatureKind.EIP_712);

      const msg1 = { traitId, tokenIds: [1, 2] };
      const sig1 = await sdk.oracle.sign712.addTraitMemberships(signer, msg1);
      const msg2 = { traitId, tokenIds: [3, 4] };
      await expect(
        oracle.addTraitMemberships(msg2, sig1, SignatureKind.EIP_712)
      ).to.be.revertedWith(Errors.UNAUTHORIZED);
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
    const traitIdV0 = sdk.oracle.projectTraitId(projectId, v0);
    const traitIdV1 = sdk.oracle.projectTraitId(projectId, v1);
    const traitIdV2 = sdk.oracle.projectTraitId(projectId, v2);

    const baseId = projectId * PROJECT_STRIDE;

    before(async () => {
      oracle = await ArtblocksTraitOracle.deploy();
      await oracle.deployed();
      await oracle.setOracleSigner(signers[1].address);

      const msg0 = { projectId, version: v0, projectName, size: size0 };
      const msg1 = { projectId, version: v1, projectName, size: size1 };

      const sig0 = await sdk.oracle.sign712.setProjectInfo(signers[1], msg0);
      const sig1 = await sdk.oracle.sign712.setProjectInfo(signers[1], msg1);

      await oracle.setProjectInfo(msg0, sig0, SignatureKind.EIP_712);
      await oracle.setProjectInfo(msg1, sig1, SignatureKind.EIP_712);
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

    const sig1 = await sdk.oracle.sign712.setProjectInfo(signers[0], msg1);
    const sig2 = await sdk.oracle.sign712.setFeatureInfo(signers[0], msg2);
    expect(sig1).not.to.equal(sig2);
  });
});
