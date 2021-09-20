const hre = require("hardhat");
const { ethers } = hre;

const TEST_CASES = [];

TEST_CASES.push(async function* marketDeploy(props) {
  const market = await props.factories.Market.deploy();
  await market.deployed();
  yield ["Market deploy", await market.deployTransaction.wait()];
});

TEST_CASES.push(async function* oracleDeploy(props) {
  const oracle = await props.factories.ArtblocksTraitOracle.deploy();
  await oracle.deployed();
  yield ["ArtblocksTraitOracle deploy", await oracle.deployTransaction.wait()];
});
});

async function main() {
  await hre.run("compile", { quiet: true });
  const { patterns } = parseArgs();
  function testCaseMatches(name) {
    if (patterns.length === 0) return true;
    return patterns.some((p) => name.match(p));
  }
  const [ArtblocksTraitOracle, Market] = await Promise.all([
    ethers.getContractFactory("ArtblocksTraitOracle"),
    ethers.getContractFactory("Market"),
  ]);
  let allPassed = true;
  for (const testCase of TEST_CASES) {
    if (!testCaseMatches(testCase.name)) continue;
    try {
      const gen = testCase({
        factories: {
          ArtblocksTraitOracle,
          Market,
        },
        signers: await ethers.getSigners(),
      });
      for await (const [label, gasOrReceipt] of gen) {
        let gas;
        if (ethers.BigNumber.isBigNumber(gasOrReceipt.gasUsed)) {
          gas = gasOrReceipt.gasUsed;
        } else {
          gas = gasOrReceipt;
        }
        console.log(`${label}: ${formatGas(gas)}`);
      }
    } catch (e) {
      allPassed = false;
      console.error(`Error in ${testCase.name}:`, e);
    }
  }
  if (!allPassed) process.exitCode = 1;
}

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const patterns = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    try {
      patterns.push(RegExp(arg, "i"));
    } catch (e) {
      throw `In argument ${i + 1}: ${e.message}`;
    }
  }
  return { patterns };
}

function formatGas(gas, samplePrice = 10n ** 9n * 150n) {
  const sampleCost = ethers.utils.formatUnits(gas.mul(samplePrice));
  const gweiStr = ethers.utils.formatUnits(samplePrice, 9);
  const costStr = `${sampleCost} ETH @ ${gweiStr} gwei/gas`;
  return `${gas.toString()} gas (${costStr})`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
