const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Popcnt", () => {
  let Popcnt;
  let fixture;
  before(async () => {
    Popcnt = await ethers.getContractFactory("PopcntFixture");
    fixture = await Popcnt.deploy();
    await fixture.deployed();
  });

  it("computes `popcnt(0)`", async () => {
    expect(await fixture.popcnt(0)).to.equal(0);
  });

  it("computes `popcnt(-1)`", async () => {
    expect(await fixture.popcnt(ethers.constants.MaxUint256)).to.equal(256);
  });

  it("computes `popcnt(2^n)` for `n: u8`", async () => {
    const inputs = Array(256)
      .fill()
      .map((_, i) => 1n << BigInt(i));
    const outputs = await fixture.popcntMany(inputs);
    expect(outputs).to.deep.equal(inputs.map(() => ethers.constants.One));
  });

  it("computes `popcnt(2^n - 1)` for `n: u8`", async () => {
    const inputs = Array(256)
      .fill()
      .map((_, i) => (1n << BigInt(i)) - 1n);
    const outputs = await fixture.popcntMany(inputs);
    expect(outputs).to.deep.equal(
      inputs.map((_, i) => ethers.BigNumber.from(i))
    );
  });

  const randomTestCases = [
    ["0xcc562fd31ac01e8de1b09c685bff90dfcf94a757838593fd17452c44804c0c55", 125],
    ["0xe2747a6335e224028fd753b79c3c9c18965584fdf1939da1b92a3643c54cb83f", 129],
    ["0xf1ba1ebb891c3119058329a768855316f8a517eff880b6757e65afdc6d1c8855", 129],
    ["0xf62cdfea8cffcfeda199ec2a11d8ca6779a2d40941b3cbd43fc03f25d8062375", 135],
    ["0xd940d3bf1bf6d198a073e3b580392eeb0acc522f941e29078f16719af4cf45db", 130],
    ["0x5d163a5180f2adbc6f2ac7b25c9ca5a7f180c3dc589e385c6667b759f4020a8b", 127],
    ["0x2ad77f959bad5f930926477efaed9840410768b9ea2ee2c107941213efae5110", 127],
    ["0x7ce2d0ac164054b36173804132df2bc69780a804fc544a33f69b05413001c044", 105],
  ];
  it("handles some arbitrary large constants", async () => {
    for (const [input, expected] of randomTestCases) {
      expect(await fixture.popcnt(input)).to.equal(expected);
    }
  });
});
