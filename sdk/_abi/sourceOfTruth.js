const ArchipelagoMarket = require("../../artifacts/contracts/ArchipelagoMarket.sol/ArchipelagoMarket.json");

function inputOfMethod(contract, name) {
  const qn = `${contract.contractName}.${name}`;
  const methods = contract.abi.filter((x) => x.name === name);
  if (methods.length === 0) {
    throw new Error(`no method ${qn}`);
  }
  if (methods.length !== 1) {
    throw new Error(`multiple methods ${qn}: n = ${methods.length}`);
  }
  const method = methods[0];
  if (method.inputs.length !== 1) {
    throw new Error(
      `method ${qn} should have exactly 1 argument, but has ${method.inputs.length}`
    );
  }
  return method.inputs[0];
}

module.exports = [
  { filename: "ask.js", data: inputOfMethod(ArchipelagoMarket, "askHash") },
  { filename: "bid.js", data: inputOfMethod(ArchipelagoMarket, "bidHash") },
  {
    filename: "orderAgreement.js",
    data: inputOfMethod(ArchipelagoMarket, "orderAgreementHash"),
  },
];
