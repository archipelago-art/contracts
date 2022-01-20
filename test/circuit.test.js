const { expect } = require("chai");
const { ethers } = require("hardhat");

const sdk = require("../sdk");

describe("sdk/circuit", () => {
  // Expands a long bytestring into 32-byte chunks for inspection and diffing.
  function formatWords(data) {
    return ethers.utils
      .hexlify(data)
      .slice(2)
      .split(/(.{64})/)
      .filter(Boolean);
  }

  const underlyingOracle = "0x" + "fe".repeat(20);

  describe("encodeTrait", () => {
    it("encodes an empty circuit", () => {
      const underlyingOracle = ethers.constants.AddressZero;
      const circuit = {
        baseTraits: [],
        ops: [],
      };
      const trait = sdk.circuit.encodeTrait(underlyingOracle, circuit);
      expect(formatWords(trait)).to.deep.equal([
        // underlying oracle address
        "0000000000000000000000000000000000000000000000000000000000000000",
        // lengths: none
        "0000000000000000000000000000000000000000000000000000000000000000",
        // opcodes: none
        "0000000000000000000000000000000000000000000000000000000000000000",
        // no data or args
      ]);
    });

    it("encodes a representative circuit", () => {
      const baseTraits = [
        "0x",
        "0x" + "12".repeat(8),
        "0x" + "34".repeat(16),
        "0x" + "56".repeat(42),
      ];
      const ops = [
        // v[4] := or(v[0], v[1])
        { type: "OR", arg0: 0, arg1: 1 },
        // v[5] := not(v[3])
        { type: "NOT", arg: 3 },
        // v[6] := or(v[2], v[5])
        { type: "OR", arg0: 2, arg1: 5 },
        // v[7] := and(v[4], v[6])
        { type: "AND", arg0: 4, arg1: 6 },
        // v[7] := stop()
        // (never strictly necessary, but valid, so let's test it)
        { type: "STOP" },
      ];
      const circuit = { baseTraits, ops };
      const trait = sdk.circuit.encodeTrait(underlyingOracle, circuit);
      expect(formatWords(trait)).to.deep.equal([
        // underlying oracle address
        "000000000000000000000000fefefefefefefefefefefefefefefefefefefefe",
        // lengths: 42 + 1 = 0x002b; 16 + 1 = 0x0011; 8 + 1 = 0x0009; 0 + 1 = 0x0001
        "000000000000000000000000000000000000000000000000002b001100090001",
        // opcodes, little-endian: 0b00_11_10_01_10 = 0x00e6
        "00000000000000000000000000000000000000000000000000000000000000e6",
        // data plus args (args: [0x00, 0x01, 0x03, 0x02, 0x05, 0x04, 0x06])
        "1212121212121212343434343434343434343434343434345656565656565656",
        "5656565656565656565656565656565656565656565656565656565656565656",
        "565600010302050406",
      ]);
    });

    it("encodes a circuit with a maximum-length base trait", () => {
      const short = "0xba";
      const long = "0x" + "6e61".repeat(32767);
      expect(ethers.utils.hexDataLength(long)).to.equal(0xfffe);
      const baseTraits = [short, long];
      const ops = [{ type: "OR", arg0: 0, arg1: 1 }];
      const circuit = { baseTraits, ops };
      const trait = sdk.circuit.encodeTrait(underlyingOracle, circuit);

      const expected =
        "0x" +
        [
          // underlying oracle address
          "000000000000000000000000fefefefefefefefefefefefefefefefefefefefe",
          // lengths: 65534 + 1 = 0xffff; 1 + 1 = 0x0002
          "00000000000000000000000000000000000000000000000000000000ffff0002",
          // opcodes: 0b10 = 0x02
          "0000000000000000000000000000000000000000000000000000000000000002",
          // data
          short.replace(/^0x/, ""),
          long.replace(/^0x/, ""),
          // args
          "0001",
        ].join("");
      expect(formatWords(trait)).to.deep.equal(formatWords(expected));
    });

    it("rejects a circuit with a base trait that is too long", () => {
      const tooLong = "0x" + "54".repeat(65535);
      expect(ethers.utils.hexDataLength(tooLong)).to.equal(0xffff);
      const baseTraits = [tooLong];
      const ops = [];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "base trait 0 too long: 65535 > 65534"
      );
    });

    it("encodes a circuit with the maximum number of base traits", () => {
      const baseTraits = Array(16)
        .fill()
        .map((_, i) => "0x0" + i.toString(16));
      const ops = [{ type: "OR", arg0: 0, arg1: 15 }];
      const circuit = { baseTraits, ops };
      const trait = sdk.circuit.encodeTrait(underlyingOracle, circuit);
      expect(formatWords(trait)).to.deep.equal([
        // underlying oracle address
        "000000000000000000000000fefefefefefefefefefefefefefefefefefefefe",
        // lengths: 1 + 1 = 0x0002 (16 times)
        "0002000200020002000200020002000200020002000200020002000200020002",
        // opcodes: 0b10 = 0x02
        "0000000000000000000000000000000000000000000000000000000000000002",
        // data, then args [0x00, 0x0f]
        "000102030405060708090a0b0c0d0e0f000f",
      ]);
    });

    it("rejects a circuit with too many base traits", () => {
      const baseTraits = Array(17).fill("0x");
      const ops = [];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "too many base traits: 17 > 16"
      );
    });

    it("encodes a circuit with the maximum number of ops", () => {
      const baseTraits = ["0xabcdef"];
      const ops = Array(128)
        .fill()
        .map((_, i) => ({ type: "NOT", arg: i }));
      const circuit = { baseTraits, ops };
      const trait = sdk.circuit.encodeTrait(underlyingOracle, circuit);
      const expected =
        "0x" +
        [
          // underlying oracle address
          "000000000000000000000000fefefefefefefefefefefefefefefefefefefefe",
          // lengths: 3 + 1 = 0x0004
          "0000000000000000000000000000000000000000000000000000000000000004",
          // opcodes: 0b01_01_01_01 = 0x55
          "5555555555555555555555555555555555555555555555555555555555555555",
          // data
          "abcdef",
          // args
          ...Array(128)
            .fill()
            .map((_, i) => i.toString(16).padStart(2, "0")),
        ].join("");
      expect(formatWords(trait)).to.deep.equal(formatWords(expected));
    });

    it("rejects a circuit with too many ops", () => {
      const baseTraits = [];
      const ops = Array(129).fill({ type: "NOT", arg: 0 });
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "too many ops: 129 > 128"
      );
    });

    it("rejects a circuit with an unknown op type", () => {
      const baseTraits = [];
      const ops = [{ type: "WAT", arg: 0 }];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "unknown op type: WAT"
      );
    });

    it("rejects a circuit with a negative op argument", () => {
      const baseTraits = [];
      const ops = [{ type: "NOT", arg: -1 }];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "bad op argument: -1"
      );
    });

    it("rejects a circuit with an op argument over 0xff", () => {
      const baseTraits = [];
      const ops = [{ type: "NOT", arg: 256 }];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "bad op argument: 256"
      );
    });

    it("rejects a circuit with a missing op argument", () => {
      const baseTraits = [];
      const ops = [{ type: "OR", arg0: 0 }];
      const circuit = { baseTraits, ops };
      expect(() => sdk.circuit.encodeTrait(underlyingOracle, circuit)).to.throw(
        "bad op argument: undefined"
      );
    });
  });

  describe("compile", () => {
    it("encodes a representative test case", () => {
      const input = sdk.circuit.allOf([
        sdk.circuit.allOf([
          sdk.circuit.allOf([]),
          sdk.circuit.allOf([sdk.circuit.baseTrait("0x10")]),
          sdk.circuit.anyOf([
            sdk.circuit.baseTrait("0x20"),
            sdk.circuit.baseTrait("0x21"),
            sdk.circuit.baseTrait("0x22"),
          ]),
          sdk.circuit.anyOf([]),
          sdk.circuit.anyOf([sdk.circuit.baseTrait("0x30")]),
          sdk.circuit.allOf([
            sdk.circuit.baseTrait("0x40"),
            sdk.circuit.baseTrait("0x41"),
            sdk.circuit.baseTrait("0x42"),
          ]),
        ]),
      ]);
      const circuit = {
        baseTraits: [
          /*  0 */ "0x10",
          /*  1 */ "0x20",
          /*  2 */ "0x21",
          /*  3 */ "0x22",
          /*  4 */ "0x30",
          /*  5 */ "0x40",
          /*  6 */ "0x41",
          /*  7 */ "0x42",
        ],
        ops: [
          /*  8 */ { type: "NOT", arg: 255 },
          /*  9 */ { type: "AND", arg0: 8, arg1: 0 },
          /* 10 */ { type: "OR", arg0: 1, arg1: 2 },
          /* 11 */ { type: "OR", arg0: 10, arg1: 3 },
          /* 12 */ { type: "AND", arg0: 9, arg1: 11 },
          /* 13 */ { type: "AND", arg0: 12, arg1: 255 },
          /* 14 */ { type: "AND", arg0: 13, arg1: 4 },
          /* 15 */ { type: "AND", arg0: 5, arg1: 6 },
          /* 16 */ { type: "AND", arg0: 15, arg1: 7 },
          /* 17 */ { type: "AND", arg0: 14, arg1: 16 },
        ],
      };
      const actual = sdk.circuit.compile(underlyingOracle, input);
      expect(formatWords(actual)).to.deep.equal(
        formatWords(sdk.circuit.encodeTrait(underlyingOracle, circuit))
      );
    });
  });
});
