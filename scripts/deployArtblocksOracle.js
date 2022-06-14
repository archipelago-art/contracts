const deploy = require("./deploy");

async function main() {
  deploy("ArtblocksOracle");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
