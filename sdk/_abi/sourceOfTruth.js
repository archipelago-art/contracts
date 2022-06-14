const ArchipelagoMarket = require("../../artifacts/contracts/ArchipelagoMarket.sol/ArchipelagoMarket.json");
const ArtblocksOracle = require("../../artifacts/contracts/ArtblocksOracle.sol/ArtblocksOracle.json");

function inputOfMethod(contract, name, argumentIndex = null) {
  const qn = `${contract.contractName}.${name}`;
  const methods = contract.abi.filter((x) => x.name === name);
  if (methods.length === 0) {
    throw new Error(`no method ${qn}`);
  }
  if (methods.length !== 1) {
    throw new Error(`multiple methods ${qn}: n = ${methods.length}`);
  }
  const method = methods[0];
  if (argumentIndex != null) {
    if (method.inputs.length <= argumentIndex) {
      const wantAtLeast = argumentIndex + 1;
      throw new Error(
        `method ${qn} should have at least ${wantAtLeast} argument(s), but has ${method.inputs.length}`
      );
    }
    return method.inputs[argumentIndex];
  }
  if (method.inputs.length !== 1) {
    throw new Error(
      `method ${qn} should have exactly 1 argument, but has ${method.inputs.length}`
    );
  }
  return method.inputs[0];
}

module.exports = [
  { filename: "archipelagoMarket.js", data: ArchipelagoMarket.abi },
  { filename: "ask.js", data: inputOfMethod(ArchipelagoMarket, "askHash") },
  { filename: "bid.js", data: inputOfMethod(ArchipelagoMarket, "bidHash") },
  {
    filename: "orderAgreement.js",
    data: inputOfMethod(ArchipelagoMarket, "orderAgreementHash"),
  },
  {
    filename: "setFeatureInfoMessage.js",
    data: inputOfMethod(ArtblocksOracle, "setFeatureInfo", 0),
  },
  {
    filename: "setProjectInfoMessage.js",
    data: inputOfMethod(ArtblocksOracle, "setProjectInfo", 0),
  },
  {
    filename: "updateTraitMessage.js",
    data: inputOfMethod(ArtblocksOracle, "updateTrait", 0),
  },
];
