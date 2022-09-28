const { expect } = require("chai");
const { ethers } = require("hardhat");

const { AddressZero, MaxUint256 } = ethers.constants;

const sdk = require("../sdk");

describe("ManifoldRoyaltyOracle", () => {
  let ManifoldRoyaltyOracle;
  let TestManifoldDataSource;

  let oracle;
  let getRoyalties;
  let signers;
  before(async () => {
    signers = await ethers.getSigners();

    [ManifoldRoyaltyOracle, TestManifoldDataSource] = await Promise.all([
      ethers.getContractFactory("ManifoldRoyaltyOracle"),
      ethers.getContractFactory("TestManifoldDataSource"),
    ]);
    oracle = await ManifoldRoyaltyOracle.deploy();
    await oracle.deployed();

    // Internally, `testDataSource`'s contract state is shared across test
    // cases, but it's only accessible through the `getRoyalties` function,
    // which starts by resetting the contract state, so nothing should leak
    // across test cases.
    const testDataSource = await TestManifoldDataSource.deploy();
    getRoyalties = async function getRoyalties({
      recipients = [],
      bps = [],
      expectedTokenId = 1,
      actualTokenId = 1,
      reverts = false,
    } = {}) {
      await testDataSource.set({ recipients, bps }, expectedTokenId, reverts);
      return oracle.royalties(
        testDataSource.address,
        actualTokenId,
        12345, // should be unused
        "0xdeadbeef" // should be unused
      );
    };
  });

  it("returns empty royalties", async () => {
    expect(await getRoyalties()).to.deep.equal([]);
  });

  it("returns two royalties", async () => {
    const [alice, bob] = signers;
    expect(
      await getRoyalties({
        recipients: [alice.address, bob.address],
        bps: [100, 50],
      })
    ).to.deep.equal([
      [alice.address, 10000],
      [bob.address, 5000],
    ]);
  });

  it("reverts if `recipients` is longer than `bps`", async () => {
    const [alice, bob] = signers;
    await expect(
      getRoyalties({
        recipients: [alice.address, bob.address],
        bps: [7],
      })
    ).to.be.revertedWith("ManifoldRoyaltyOracle: inconsistent lengths");
  });

  it("reverts if `bps` is longer than `recipients`", async () => {
    const [alice, bob] = signers;
    await expect(
      getRoyalties({
        recipients: [alice.address],
        bps: [7, 8],
      })
    ).to.be.revertedWith("ManifoldRoyaltyOracle: inconsistent lengths");
  });

  it("reverts if the royalty amount in micros can't fit into a uint32", async () => {
    const [alice, bob] = signers;
    await expect(
      getRoyalties({
        recipients: [alice.address],
        bps: [99_999_999],
      })
    ).to.be.revertedWith("ManifoldRoyaltyOracle: bps out of range");
  });

  it("reverts if the underlying data source reverts", async () => {
    const [alice, bob] = signers;
    await expect(getRoyalties({ reverts: true })).to.be.revertedWith(
      "TestManifoldDataSource: revert!"
    );
  });

  it("queries the right token ID", async () => {
    (
      await expect(getRoyalties({ expectedTokenId: 1, actualTokenId: 2 }))
    ).to.be.revertedWith("TestManifoldDataSource: wrong token ID!");
  });
});
