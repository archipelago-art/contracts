const hre = require("hardhat");

const updateAbi = require("../sdk/_abi/update");

async function main() {
  await hre.run("compile", { quiet: true });
  await updateAbi();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
