const deploy = require("./deploy");

async function main() {
  deploy("CircuitOracle");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
