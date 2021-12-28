const ethers = require("ethers");

/*::
type OpStop = { type: "STOP" };
type OpNot = { type: "NOT", arg: int };
type OpOr = { type: "OR", arg0: int, arg1: int };
type OpAnd = { type: "AND", arg0: int, arg1: int };
type Op = OpStop | OpNot | OpOr | OpAnd;
*/

const OP_STOP = 0;
const OP_NOT = 1;
const OP_OR = 2;
const OP_AND = 3;

function encodeTrait({
  underlyingOracle /*: address */,
  baseTraits /*: bytes[] */,
  ops /*: Op[] */,
}) {
  if (baseTraits.length > 16)
    throw new Error(`too many base traits: ${baseTraits.length} > 16`);
  if (ops.length > 128) throw new Error(`too many ops: ${ops.length} > 128`);

  let lengths = 0n;
  for (let i = baseTraits.length - 1; i >= 0; i--) {
    const trait = baseTraits[i];
    const length = ethers.utils.hexDataLength(trait);
    const maxLength = 0xfffe;
    if (length > maxLength)
      throw new Error(`base trait ${i} too long: ${length} > ${maxLength}`);
    lengths = (lengths << 16n) | BigInt(length + 1);
  }

  function parseArg(arg) {
    if (!Number.isInteger(arg) || arg < 0 || arg > 0xff)
      throw new Error(`bad op argument: ${arg}`);
    return arg;
  }
  const parsedOps = ops.map((op) => {
    switch (op.type) {
      case "STOP":
        return { opcode: OP_STOP, args: [] };
      case "NOT":
        return { opcode: OP_NOT, args: [parseArg(op.arg)] };
      case "OR":
        return { opcode: OP_OR, args: [parseArg(op.arg0), parseArg(op.arg1)] };
      case "AND":
        return { opcode: OP_AND, args: [parseArg(op.arg0), parseArg(op.arg1)] };
      default:
        throw new Error(`unknown op type: ${op.type}`);
    }
  });

  let opcodes = 0n;
  for (let i = parsedOps.length - 1; i >= 0; i--) {
    const opcode = parsedOps[i].opcode;
    opcodes = (opcodes << 2n) | BigInt(opcode);
  }

  const staticPart = ethers.utils.defaultAbiCoder.encode(
    ["address", "uint256", "uint256"],
    [underlyingOracle, lengths, opcodes]
  );
  const args = new Uint8Array(parsedOps.flatMap((op) => op.args));
  return ethers.utils.hexConcat([staticPart, ...baseTraits, args]);
}

module.exports = { encodeTrait };
