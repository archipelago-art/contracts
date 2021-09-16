const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Market", () => {
  let Market;
  before(async () => {
    Market = await ethers.getContractFactory("Market");
  });

  it("deploys", async () => {
    const market = await Market.deploy();
    await market.deployed();
  });
});
