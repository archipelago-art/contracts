const { expect } = require("chai");
const { ethers } = require("hardhat");

const { AddressZero, MaxUint256 } = ethers.constants;

const sdk = require("../sdk");

describe("PbabRoyaltyOracle", () => {
  let PbabRoyaltyOracle;
  let TestPbabRoyaltyDataSource;

  // The Nursery (project 7) royalty data as of mainnet block 15138407,
  // on contract 0x0A1BBD57033F57E7B6743621b79fCB9Eb2CE3676.
  const ARTBLOCKS_ADDRESS = "0xf7A55108A6E830a809e88e74cbf5f5DE9D930153";
  const ARTIST_0 = "0x8dFB9266A18efcDBC1c570248CC47e520D9307B0";
  const ARTIST_1 = "0x4944303979b8d8DA50CcE0f1C145c715950a7abe";
  const ARTIST_1_SPLIT = 10;

  const MICROS_ARTBLOCKS = 25000;
  const MICROS_ARTISTS = 50000;
  const MICROS_ARTIST_0 = (MICROS_ARTISTS * 90) / 100;
  const MICROS_ARTIST_1 = (MICROS_ARTISTS * 10) / 100;
  if (
    !Number.isInteger(MICROS_ARTIST_0) ||
    !Number.isInteger(MICROS_ARTIST_1) ||
    MICROS_ARTIST_0 + MICROS_ARTIST_1 !== MICROS_ARTISTS ||
    (MICROS_ARTIST_1 * 100) / MICROS_ARTISTS !== ARTIST_1_SPLIT
  ) {
    throw new Error("fix test constants");
  }

  let artblocksRoyaltyOracle;
  let getRoyalties;
  before(async () => {
    [PbabRoyaltyOracle, TestPbabRoyaltyDataSource] = await Promise.all([
      ethers.getContractFactory("PbabRoyaltyOracle"),
      ethers.getContractFactory("TestPbabRoyaltyDataSource"),
    ]);
    artblocksRoyaltyOracle = await PbabRoyaltyOracle.deploy();
    await artblocksRoyaltyOracle.deployed();

    // Internally, `testDataSource`'s contract state is shared across test
    // cases, but it's only accessible through the `getRoyalties` function,
    // which starts by resetting the contract state, so nothing should leak
    // across test cases.
    const testDataSource = await TestPbabRoyaltyDataSource.deploy();
    getRoyalties = async function getRoyalties({
      artblocksAddress = ARTBLOCKS_ADDRESS,
      artist0 = ARTIST_0,
      artist1 = ARTIST_1,
      artist1Split = ARTIST_1_SPLIT,
      royaltyFeeById = 77, // should be unused by contract
      micros = MICROS_ARTISTS + MICROS_ARTBLOCKS,
      data = MICROS_ARTBLOCKS,
      renderProviderAddressReverts = false,
      getRoyaltyDataReverts = false,
    } = {}) {
      const TOKEN_ID = "163000801";
      await testDataSource.set(
        artblocksAddress,
        TOKEN_ID,
        {
          artistAddress: artist0,
          additionalPayee: artist1,
          additionalPayeePercentage: artist1Split,
          royaltyFeeByID: royaltyFeeById,
        },
        renderProviderAddressReverts,
        getRoyaltyDataReverts
      );
      return artblocksRoyaltyOracle.royalties(
        testDataSource.address,
        TOKEN_ID,
        micros,
        data
      );
    };
  });

  it("splits royalty between platform and two artists", async () => {
    expect(await getRoyalties()).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_0, MICROS_ARTIST_0],
      [ARTIST_1, MICROS_ARTIST_1],
    ]);
  });

  it("omits platform royalty if payee is null", async () => {
    expect(await getRoyalties({ artblocksAddress: AddressZero })).to.deep.equal(
      [
        [ARTIST_0, MICROS_ARTIST_0],
        [ARTIST_1, MICROS_ARTIST_1],
      ]
    );
  });

  it("splits royalty between platform and single artist", async () => {
    expect(
      await getRoyalties({
        artist1: AddressZero,
        artist1Split: 0,
      })
    ).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_0, MICROS_ARTISTS],
    ]);
  });

  it("ignores second artist if address is null, even if split is nonzero", async () => {
    expect(
      await getRoyalties({
        artist1: AddressZero,
        artist1Split: 50,
      })
    ).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_0, MICROS_ARTISTS],
    ]);
  });

  it("ignores second artist if split is zero, even if address is nonzero", async () => {
    expect(await getRoyalties({ artist1Split: 0 })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_0, MICROS_ARTISTS],
    ]);
  });

  it("ignores first artist if address is null, even if split is nonzero", async () => {
    expect(await getRoyalties({ artist0: AddressZero })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_1, MICROS_ARTISTS],
    ]);
  });

  it("ignores first artist if split is zero, even if address is nonzero", async () => {
    expect(await getRoyalties({ artist1Split: 100 })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_1, MICROS_ARTISTS],
    ]);
  });

  it("treats over-100% splits to second artist as 100%", async () => {
    expect(await getRoyalties({ artist1Split: 101 })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_1, MICROS_ARTISTS],
    ]);
    expect(await getRoyalties({ artist1Split: MaxUint256 })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
      [ARTIST_1, MICROS_ARTISTS],
    ]);
  });

  it("ignores both artists if addresses are null", async () => {
    expect(
      await getRoyalties({ artist0: AddressZero, artist1: AddressZero })
    ).to.deep.equal([[ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS]]);
  });

  it("ignores all royalties if platform and artists are all null", async () => {
    expect(
      await getRoyalties({
        artblocksAddress: AddressZero,
        artist0: AddressZero,
        artist1: AddressZero,
      })
    ).to.deep.equal([]);
  });

  it("ignores platform royalties if `_data == 0`", async () => {
    expect(
      await getRoyalties({ data: 0, micros: MICROS_ARTISTS })
    ).to.deep.equal([
      [ARTIST_0, MICROS_ARTIST_0],
      [ARTIST_1, MICROS_ARTIST_1],
    ]);
  });

  it("ignores artist royalties if `_data == _micros`", async () => {
    expect(
      await getRoyalties({ data: MICROS_ARTBLOCKS, micros: MICROS_ARTBLOCKS })
    ).to.deep.equal([[ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS]]);
  });

  it("reverts if `_data > _micros` (platform royalty too high)", async () => {
    await expect(
      getRoyalties({ data: 10000, micros: 5000 })
    ).to.be.revertedWith(
      "ArtblocksRoyaltyOracle: Art Blocks platform royalty exceeds total royalty"
    );
  });

  it("ignores platform royalties if `artblocksAddress()` reverts", async () => {
    expect(
      await getRoyalties({ renderProviderAddressReverts: true })
    ).to.deep.equal([
      [ARTIST_0, MICROS_ARTIST_0],
      [ARTIST_1, MICROS_ARTIST_1],
    ]);
  });

  it("ignores artist royalties if `getRoyaltyData(_tokenId)` reverts", async () => {
    expect(await getRoyalties({ getRoyaltyDataReverts: true })).to.deep.equal([
      [ARTBLOCKS_ADDRESS, MICROS_ARTBLOCKS],
    ]);
  });

  it("ignores all royalties if `artblocksAddress()` and `getRoyaltyData(_tokenId)` both revert", async () => {
    expect(
      await getRoyalties({
        renderProviderAddressReverts: true,
        getRoyaltyDataReverts: true,
      })
    ).to.deep.equal([]);
  });
});
