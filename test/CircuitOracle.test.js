const { expect } = require("chai");
const { ethers } = require("hardhat");

const sdk = require("../sdk");

describe("CircuitOracle", () => {
  let CircuitOracle;
  let TestTraitOracle;

  let circuitOracle;
  before(async () => {
    [CircuitOracle, TestTraitOracle] = await Promise.all([
      ethers.getContractFactory("CircuitOracle"),
      ethers.getContractFactory("TestTraitOracle"),
    ]);
    circuitOracle = await CircuitOracle.deploy();
    await circuitOracle.deployed();
  });

  const tokenContract = "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270";
  const tokenId = "163000801";

  async function setUp({ traits = [] } = {}) {
    const testOracle = await TestTraitOracle.deploy();
    await testOracle.deployed();
    const hashes = traits.map((t) => ethers.utils.keccak256(t));
    await testOracle.setHashes(tokenContract, tokenId, hashes);
    return async (circuit, overrides) => {
      const inputs = {
        underlyingOracle: testOracle.address,
        tokenContract,
        tokenId,
        ...overrides,
      };
      const trait = sdk.circuit.encodeTrait({
        underlyingOracle: inputs.underlyingOracle,
        baseTraits: [],
        ops: [],
        ...circuit,
      });
      return await circuitOracle.hasTrait(
        inputs.tokenContract,
        inputs.tokenId,
        trait
      );
    };
  }

  describe("circuits with no base traits", () => {
    let check;
    before(async () => {
      check = await setUp();
    });

    it("empty circuit => false", async () => {
      expect(await check({ ops: [] })).to.equal(false);
    });

    it("!false => true", async () => {
      expect(await check({ ops: [{ type: "NOT", arg: 0 }] })).to.equal(true);
    });

    it("!!false => false", async () => {
      expect(
        await check({
          ops: [
            // `v[0] := !v[0]` (initially, `v[0]` is `false`, so this is `true`)
            { type: "NOT", arg: 0 },
            // `v[1] := !v[0]` (due to the previous statement, this is `false`)
            { type: "NOT", arg: 0 },
          ],
        })
      ).to.equal(false);
    });

    it("false || !false => true", async () => {
      expect(
        await check({
          ops: [
            { type: "NOT", arg: 0 },
            { type: "OR", arg0: 0, arg1: 1 },
          ],
        })
      ).to.equal(true);
    });

    it("false && !false => false", async () => {
      expect(
        await check({
          ops: [
            { type: "NOT", arg: 0 },
            { type: "AND", arg0: 0, arg1: 1 },
          ],
        })
      ).to.equal(false);
    });

    it("ops beyond STOP are not processed", async () => {
      expect(
        await check({
          ops: [
            { type: "NOT", arg: 0 },
            { type: "STOP" },
            { type: "NOT", arg: 1 },
          ],
        })
      ).to.equal(true);
    });
  });

  describe("circuits with empty, short, and long base traits", () => {
    const empty = "0x";
    const short = "0xface";
    const long = ethers.utils.toUtf8Bytes(
      "according to all known laws of aviation there is no way that a bee should be able to fly"
    );
    const unset = "0xc076fefe";

    let check;
    before(async () => {
      check = await setUp({ traits: [empty, short, long] });
    });

    it("empty circuit with last base trait true => true", async () => {
      expect(await check({ baseTraits: [empty] })).to.equal(true);
      expect(await check({ baseTraits: [short] })).to.equal(true);
      expect(await check({ baseTraits: [long] })).to.equal(true);
    });

    it("empty circuit with last base trait false => false", async () => {
      expect(await check({ baseTraits: [unset] })).to.equal(false);
    });

    it("(true1 || false) && (false || true2) => true", async () => {
      expect(
        await check({
          baseTraits: [short, unset, long],
          ops: [
            { type: "OR", arg0: 0, arg1: 1 },
            { type: "OR", arg0: 1, arg1: 2 },
            { type: "AND", arg0: 3, arg1: 4 },
          ],
        })
      ).to.equal(true);
    });

    it("(true1 && false) || (false && true2) => true", async () => {
      expect(
        await check({
          baseTraits: [short, unset, long],
          ops: [
            { type: "AND", arg0: 0, arg1: 1 },
            { type: "AND", arg0: 1, arg1: 2 },
            { type: "OR", arg0: 3, arg1: 4 },
          ],
        })
      ).to.equal(false);
    });

    it("circuit with 128 ops where only the last one is true => true", async () => {
      expect(
        await check({
          baseTraits: [short, unset, long],
          ops: [
            ...Array(127).fill({ type: "NOT", arg: 0 }),
            { type: "NOT", arg: 1 },
          ],
        })
      ).to.equal(true);
    });

    it("circuit with 128 ops where only the last one is false => false", async () => {
      expect(
        await check({
          baseTraits: [short, unset, long],
          ops: [
            ...Array(127).fill({ type: "NOT", arg: 1 }),
            { type: "NOT", arg: 0 },
          ],
        })
      ).to.equal(false);
    });

    function conjunctionOf16() {
      return [
        // v[16] := and(v[0], v[1])
        { type: "AND", arg0: 0, arg1: 1 },
        // v[17] := and(v[2], v[16])
        // v[18] := and(v[3], v[17])
        // ...
        // v[29] := and(v[14], v[28])
        // v[30] := and(v[15], v[29])
        ...Array(14)
          .fill()
          .map((_, i) => ({ type: "AND", arg0: i + 2, arg1: i + 16 })),
      ];
    }

    it("circuit with 16 base traits, all used => true", async () => {
      expect(
        await check({
          baseTraits: Array(16).fill(short),
          ops: conjunctionOf16(),
        })
      ).to.equal(true);
    });

    it("circuit with 16 base traits, all used => false", async () => {
      expect(
        await check({
          baseTraits: [...Array(15).fill(short), unset],
          ops: conjunctionOf16(),
        })
      ).to.equal(false);
    });
  });

  describe("circuits with maximum-length base traits", () => {
    function maxLengthTrait(nonce) {
      // Have to use mostly zero bytes to respect the gas cap.
      const pre = ethers.utils.toUtf8Bytes(nonce);
      const suf = ethers.utils.toUtf8Bytes(nonce.split("").reverse().join(""));
      const middle = "0x" + "00".repeat(0xfffe - 2 * nonce.length);
      return ethers.utils.hexConcat([pre, middle, suf]);
    }
    const longSet = maxLengthTrait("orange_roughie");
    const longUnset = maxLengthTrait("banana_smoothie");
    const emptyUnset = "0x";

    let check;
    before(async () => {
      check = await setUp({ traits: [longSet] });
    });

    it("longTrueTrait && !false => true", async () => {
      expect(
        await check({
          baseTraits: [longSet, emptyUnset],
          ops: [
            { type: "NOT", arg: 1 },
            { type: "AND", arg0: 0, arg1: 2 },
          ],
        })
      ).to.equal(true);
    });

    it("false || longFalseTrait => false", async () => {
      expect(
        await check({
          baseTraits: [emptyUnset, longUnset],
          ops: [{ type: "OR", arg0: 1, arg1: 0 }],
        })
      ).to.equal(false);
    });
  });

  describe("recursive self-calls", () => {
    it("work", async () => {
      const trueTrait = "0xf00d";
      const falseTrait = "0xdead";

      const testOracle = await TestTraitOracle.deploy();
      await testOracle.deployed();
      await testOracle.setTrait(tokenContract, tokenId, trueTrait);

      const trueAndFalse = sdk.circuit.encodeTrait({
        underlyingOracle: testOracle.address,
        baseTraits: [trueTrait, falseTrait],
        ops: [{ type: "AND", arg0: 0, arg1: 1 }],
      });
      const trueOrFalse = sdk.circuit.encodeTrait({
        underlyingOracle: testOracle.address,
        baseTraits: [trueTrait, falseTrait],
        ops: [{ type: "OR", arg0: 0, arg1: 1 }],
      });
      const orAndNotAnd = sdk.circuit.encodeTrait({
        underlyingOracle: circuitOracle.address,
        baseTraits: [trueOrFalse, trueAndFalse],
        ops: [
          { type: "NOT", arg: 1 },
          { type: "AND", arg0: 0, arg1: 2 },
        ],
      });

      expect(
        await circuitOracle.hasTrait(tokenContract, tokenId, orAndNotAnd)
      ).to.equal(true);
    });
  });

  describe("errors in underlying oracle", () => {
    it("are propagated", async () => {
      const baseTrait = "0xb000";

      const testOracle = await TestTraitOracle.deploy();
      await testOracle.deployed();
      await testOracle.setRevert(tokenContract, tokenId, baseTrait);

      const trait = sdk.circuit.encodeTrait({
        underlyingOracle: testOracle.address,
        baseTraits: [baseTrait],
        ops: [],
      });

      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, trait)
      ).to.be.revertedWith("TestTraitOracle: kaboom!");
    });
  });

  describe("error cases on hand-crafted invalid inputs", () => {
    it("with empty trait", async () => {
      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, "0x")
      ).to.be.revertedWith(sdk.circuit.Errors.OVERRUN_STATIC);
    });

    it("with non-empty but truncated static header", async () => {
      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, "0x" + "00".repeat(32))
      ).to.be.revertedWith(sdk.circuit.Errors.OVERRUN_STATIC);
    });

    it("with not enough dynamic data while reading constants", async () => {
      const goodTrait = sdk.circuit.encodeTrait({
        underlyingOracle: ethers.constants.AddressZero,
        baseTraits: ["0xabcdef12"],
        ops: [],
      });
      const badTrait = goodTrait.slice(0, -2);
      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, badTrait)
      ).to.be.revertedWith(sdk.circuit.Errors.OVERRUN_CONSTANT);
    });

    it("with not enough dynamic data while reading unary operator args", async () => {
      const testOracle = await TestTraitOracle.deploy();
      await testOracle.deployed();
      const goodTrait = sdk.circuit.encodeTrait({
        underlyingOracle: testOracle.address,
        baseTraits: ["0xabcdef12"],
        ops: [
          { type: "NOT", arg: 0 },
          { type: "NOT", arg: 1 },
        ],
      });
      const badTrait = goodTrait.slice(0, -2);
      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, badTrait)
      ).to.be.revertedWith(sdk.circuit.Errors.OVERRUN_ARG);
    });

    it("with not enough dynamic data while reading binary operator args", async () => {
      const testOracle = await TestTraitOracle.deploy();
      await testOracle.deployed();
      const goodTrait = sdk.circuit.encodeTrait({
        underlyingOracle: testOracle.address,
        baseTraits: ["0xabcdef12"],
        ops: [
          { type: "AND", arg0: 0, arg1: 0 },
          { type: "OR", arg0: 1, arg1: 1 },
        ],
      });
      const badTrait = goodTrait.slice(0, -2);
      await expect(
        circuitOracle.hasTrait(tokenContract, tokenId, badTrait)
      ).to.be.revertedWith(sdk.circuit.Errors.OVERRUN_ARG);
    });
  });
});
