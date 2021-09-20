const hre = require("hardhat");
const { ethers } = hre;

const sdk = require("../sdk");
const { EIP_712 } = sdk.SignatureKind;

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

TEST_CASES.push(async function* oracleTraitMemberships(props) {
  const oracle = await props.factories.ArtblocksTraitOracle.deploy();
  await oracle.deployed();
  const signer = props.signers[0];
  await oracle.setOracleSigner(signer.address);

  const projectId = 23;
  const featureName = "Palette: Paddle";
  const version = 0;
  const traitId = sdk.oracle.featureTraitId(projectId, featureName, version);

  {
    const msg = { projectId, featureName, version };
    const sig = await sdk.oracle.sign712.setFeatureInfo(signer, msg);
    const tx = await oracle.setFeatureInfo(msg, sig, EIP_712);
    yield ["setFeatureInfo", await tx.wait()];
  }

  {
    const msg = { traitId, tokenIds: [] };
    const sig = await sdk.oracle.sign712.addTraitMemberships(signer, msg);
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: empty", await tx.wait()];
  }

  const baseTokenId = 23000000;
  let tokenIds = [467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314].map(
    (x) => x + baseTokenId
  );

  {
    const msg = { traitId, tokenIds };
    const sig = await sdk.oracle.sign712.addTraitMemberships(signer, msg);
    const tx1 = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield [
      `addTraitMemberships: Paddle (${tokenIds.length})`,
      await tx1.wait(),
    ];
    const tx2 = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: Paddle again (no-op)", await tx2.wait()];
  }

  tokenIds = Array(256)
    .fill()
    .map((_, i) => baseTokenId + 0x0100 + i);
  {
    const msg = { traitId, tokenIds };
    const sig = await sdk.oracle.sign712.addTraitMemberships(signer, msg);
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: 256 consecutive", await tx.wait()];
  }

  tokenIds = Array(256)
    .fill()
    .map((_, i) => baseTokenId + 0x0200 + i * 8);
  {
    const msg = { traitId, tokenIds };
    const sig = await sdk.oracle.sign712.addTraitMemberships(signer, msg);
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: 256 semi-scattered", await tx.wait()];
  }
});

const Mode = Object.freeze({
  TEXT: "TEXT",
  JSON: "JSON",
});

async function main() {
  await hre.run("compile", { quiet: true });
  const { mode, patterns } = parseArgs();
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
        switch (mode) {
          case Mode.TEXT:
            console.log(`${label}: ${formatGas(gas)}`);
            break;
          case Mode.JSON: {
            const keccak = ethers.utils.keccak256(
              ethers.utils.toUtf8Bytes(label)
            );
            const hash = ethers.BigNumber.from(
              ethers.utils.hexDataSlice(keccak, 0, 6)
            )
              .toBigInt()
              .toString(32)
              .padStart(10, "0");
            const blob = { hash, label, gas: gas.toString() };
            console.log(JSON.stringify(blob));
            break;
          }
          default:
            throw new Error(`Unexpected mode: ${mode}`);
        }
      }
    } catch (e) {
      allPassed = false;
      console.error(`Error in ${testCase.name}:`, e);
    }
  }
  if (!allPassed) process.exitCode = 1;
}

function parseArgs() {
  let mode = Mode.TEXT;
  const rawArgs = process.argv.slice(2);
  const patterns = [];
  let moreFlags = true;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (moreFlags && arg === "--") {
      moreFlags = false;
      continue;
    }
    if (moreFlags && arg.startsWith("-")) {
      if (arg === "-j" || arg === "--json") {
        mode = Mode.JSON;
        continue;
      }
      if (arg === "-t" || arg === "--text") {
        mode = Mode.TEXT;
        continue;
      }
      throw `In argument ${i + 1}: Unknown flag "${arg}"`;
    }
    try {
      patterns.push(RegExp(arg, "i"));
    } catch (e) {
      throw `In argument ${i + 1}: ${e.message}`;
    }
  }
  return { patterns, mode };
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
