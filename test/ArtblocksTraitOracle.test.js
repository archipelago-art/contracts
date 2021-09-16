const { expect } = require("chai");
const { ethers } = require("hardhat");

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
});
