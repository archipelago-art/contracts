const hre = require("hardhat");

async function main() {
  const ArtblocksRoyaltyOracle = await hre.ethers.getContractFactory(
    "ArtblocksRoyaltyOracle"
  );
  const [signer] = await hre.ethers.getSigners();
  console.log("Signer: " + (await signer.getAddress()));
  console.log("Deploying Art Blocks royalty oracle...");
  const market = await ArtblocksRoyaltyOracle.deploy();
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
