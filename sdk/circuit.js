const ethers = require("ethers");

const Errors = Object.freeze({
  OVERRUN_BASE_TRAIT: "CircuitOracle: base trait buffer overrun",
  OVERRUN_ARG: "CircuitOracle: arg buffer overrun",
});

/**
 * Form a circuit description using `anyOf` and `allOf` to combine `baseTrait`s:
 *
 *    // Base traits from an underlying oracle
 *    const red = "0x...";
 *    const green = "0x...";
 *    const blue = "0x...";
 *    const circle = "0x...";
 *    const square = "0x...";
 *
 *    const approvedColorAndShape = allOf([
 *      anyOf([baseTrait(red), baseTrait(green), baseTrait(blue)]),
 *      anyOf([baseTrait(circle), baseTrait(square)]),
 *    ]);
 *
 * Then use `compile` to get a trait for the circuit oracle:
 *
 *    const trait = compile(myOracle.address, approvedColorAndShape);
 */
/*::
type InputNode = InputBaseTrait | InputOp;
type InputBaseTrait = { type: "BASE_TRAIT", trait: bytes };
type InputOp = { type: "OP", op: "AND" | "OR", children: InputNode[] };
*/
function baseTrait(trait /*: bytes */) /*: InputNode */ {
  return { type: "BASE_TRAIT", trait: ethers.utils.hexlify(trait) };
}
function anyOf(children /*: InputNode[] */) /*: InputNode */ {
  return { type: "OP", op: "OR", children };
}
function allOf(children /*: InputNode[] */) /*: InputNode */ {
  return { type: "OP", op: "AND", children };
}

// Intermediate representation with constant fan-in but still recursive
// structure.
/*::
type IrNode = IrBaseTrait | IrBinop | IrConstant;
type IrBaseTrait = { type: "BASE_TRAIT", trait: bytes };
type IrBinop = { type: "BINOP", op: "AND" | "OR", left: IrNode, right: IrNode };
type IrConstant = { type: "CONSTANT", value: boolean };
*/
function inputToIr(node /*: InputNode */) /*: IrNode */ {
  switch (node.type) {
    case "BASE_TRAIT": {
      const { trait } = node;
      return { type: "BASE_TRAIT", trait };
    }
    case "OP": {
      const { op, children } = node;
      if (children.length === 0) {
        return { type: "CONSTANT", value: op === "AND" };
      }
      if (children.length === 1) {
        return inputToIr(children[0]);
      }
      const init /*: InputNode[] */ = children.slice(0, children.length - 1);
      const last /*: InputNode */ = children[children.length - 1];
      const left /*: IrNode */ = inputToIr({ type: "OP", op, children: init });
      const right /*: IrNode */ = inputToIr(last);
      return { type: "BINOP", op, left, right };
    }
    default:
      throw new Error("no such node type: " + node.type);
  }
}

function collectBaseTraits(ir /*: IrNode */) {
  const baseTraits = [];
  const baseTraitToIndex = new Map();

  // Adds all the base traits in subtree of the given node.
  function visit(node) {
    switch (node.type) {
      case "BASE_TRAIT": {
        const { trait } = node;
        if (baseTraitToIndex.has(trait)) break;
        const index = baseTraits.length;
        baseTraits.push(trait);
        baseTraitToIndex.set(trait, index);
        break;
      }
      case "CONSTANT":
        break;
      case "BINOP":
        visit(node.left);
        visit(node.right);
        break;
      default:
        throw new Error("no such IR node type: " + node.type);
    }
  }

  visit(ir);
  return { baseTraits, baseTraitToIndex };
}

/*::
type Circuit = {
  baseTraits: bytes[],
  ops: Op[],
};

type OpStop = { type: "STOP" };
type OpNot = { type: "NOT", arg: int };
type OpOr = { type: "OR", arg0: int, arg1: int };
type OpAnd = { type: "AND", arg0: int, arg1: int };
type Op = OpStop | OpNot | OpOr | OpAnd;
*/

function irToCircuit(ir /*: IrNode */) /*: Circuit */ {
  const { baseTraits, baseTraitToIndex } = collectBaseTraits(ir);
  const ops = [];
  let nextArg = baseTraits.length;

  // Returns the index of an argument (base trait or op) that evaluates to the
  // given node, possibly after adding some ops to `ops`.
  function visit(node) {
    switch (node.type) {
      case "BASE_TRAIT":
        return baseTraitToIndex.get(node.trait);
      case "CONSTANT": {
        // Cell 255 is always false because there are at most 16 base traits
        // and at most 128 ops, so cells 144 and onward are never written.
        const ALWAYS_FALSE = 255;
        if (node.value) {
          ops.push({ type: "NOT", arg: ALWAYS_FALSE });
          return nextArg++;
        } else {
          return ALWAYS_FALSE;
        }
      }
      case "BINOP": {
        const arg0 = visit(node.left);
        const arg1 = visit(node.right);
        ops.push({ type: node.op, arg0, arg1 });
        return nextArg++;
      }
    }
  }

  // In principle, we'd call `visit(ir)` to get an argument index for the
  // output, then create a dummy op like `result AND result` to make sure that
  // it's the last thing evaluated. But it turns out that we can ignore the
  // value returned by `visit(ir)` in all cases:
  //
  //  - If `ir` is a base trait, then the entire circuit contains exactly one
  //    base trait and no ops, so the base trait is already in output position.
  //  - If `ir` is the constant `false`, then the circuit contains no base
  //    traits or ops, and so evaluates to `false` by default.
  //  - If `ir` is the constant `true`, then the circuit contains exactly one
  //    op (the negation of an empty cell), already in output position.
  //  - If `ir` is a binop, then `visit(ir)` finished by appending an op to
  //    compute its result, so it's already in output position.
  //
  // Thus, merely calling `visit(ir)` for the side-effects is sufficient.
  visit(ir);
  return { baseTraits, ops };
}

function compile(
  underlyingOracle /*: address */,
  input /*: InputNode */
) /*: bytes */ {
  const ir = inputToIr(input);
  const circuit = irToCircuit(ir);
  return encodeTrait(underlyingOracle, circuit);
}

const OP_STOP = 0;
const OP_NOT = 1;
const OP_OR = 2;
const OP_AND = 3;

/**
 * Low-level compiler from circuit to trait. Use this if you already have a raw
 * circuit representation. Most clients will want to call `compile` instead,
 * which takes a higher-level Boolean formula as input.
 */
function encodeTrait(underlyingOracle /*: address */, circuit /*: Circuit */) {
  const { baseTraits, ops } = circuit;
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

module.exports = {
  Errors,
  encodeTrait,
  baseTrait,
  anyOf,
  allOf,
  compile,
};
