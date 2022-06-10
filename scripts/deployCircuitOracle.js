const hre = require("hardhat");

async function main() {
  const CircuitOracle = await hre.ethers.getContractFactory("CircuitOracle");
  const [signer] = await hre.ethers.getSigners();
  console.log("Signer: " + (await signer.getAddress()));
  console.log("Deploying circuit oracle...");
  const oracle = await CircuitOracle.deploy();
  console.log("Deploying...");
  await oracle.deployed();
  console.log(
    "Submitted deploy transaction: tx %s",
    oracle.deployTransaction.hash
  );
  const tx = await oracle.deployTransaction.wait();
  console.log(
    "Deploy transaction mined: block #%s, hash %s",
    tx.blockNumber,
    tx.blockHash
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
