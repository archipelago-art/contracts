const hre = require("hardhat");

async function main() {
  const ArchipelagoMarket = await hre.ethers.getContractFactory(
    "ArchipelagoMarket"
  );
  const [signer] = await hre.ethers.getSigners();
  console.log("Signer: " + (await signer.getAddress()));
  console.log("Deploying market...");
  const market = await ArchipelagoMarket.deploy();
  console.log("Deploying...");
  await market.deployed();
  console.log(
    "Submitted deploy transaction: tx %s",
    market.deployTransaction.hash
  );
  const tx = await market.deployTransaction.wait();
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
