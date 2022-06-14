const deploy = require("./deploy");

async function main() {
  deploy("ArtblocksRoyaltyOracle");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
