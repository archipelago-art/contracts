const deploy = require("./deploy");

async function main() {
  deploy("PbabRoyaltyOracle");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
