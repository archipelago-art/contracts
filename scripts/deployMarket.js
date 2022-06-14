const deploy = require("./deploy");

async function main() {
  deploy("ArchipelagoMarket");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
