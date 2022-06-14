const hre = require("hardhat");

async function deployContract(contractFactoryName, ...args) {
  const factory = await hre.ethers.getContractFactory(contractFactoryName);
  const [signer] = await hre.ethers.getSigners();

  const from = await signer.getAddress();
  const nonce = await signer.getTransactionCount();
  console.log("Chain ID: " + (await signer.getChainId()));
  console.log("Deployer: " + from);
  console.log("Nonce: " + nonce);
  console.log(
    "Contract address: " + hre.ethers.utils.getContractAddress({ from, nonce })
  );
  console.log();

  const argsPretty = args.map((x) => JSON.stringify(x)).join(", ");
  console.log(`Deploying ${contractFactoryName}(${argsPretty})...`);
  const contract = await factory.deploy(...args);
  console.log("Sent deploy transaction %s...", contract.deployTransaction.hash);
  const rx = await contract.deployTransaction.wait();

  console.log();
  console.log(
    "Deploy transaction mined: block #%s, hash %s",
    rx.blockNumber,
    rx.blockHash
  );
  console.log("Actual contract address: " + rx.contractAddress);
  console.log(
    "Gas used: %s gas @ effective price %s gwei/gas => %s ETH",
    String(rx.gasUsed),
    hre.ethers.utils.formatUnits(rx.effectiveGasPrice, "gwei"),
    hre.ethers.utils.formatEther(rx.gasUsed.mul(rx.effectiveGasPrice))
  );
}

module.exports = deployContract;
