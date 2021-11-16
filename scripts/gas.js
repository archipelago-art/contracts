const hre = require("hardhat");
const { ethers } = hre;

const BN = ethers.BigNumber;

const sdk = require("../sdk");
const { EIP_712 } = sdk.SignatureKind;
const { BidType } = sdk.market;

const TEST_CASES = [];

TEST_CASES.push(async function* marketDeploy(props) {
  const market = await props.factories.ArchipelagoMarket.deploy();
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
  const domain = {
    oracleAddress: oracle.address,
    chainId: await ethers.provider.send("eth_chainId"),
  };

  {
    const msg = { projectId, featureName, version };
    const sig = await sdk.oracle.sign712.setFeatureInfo(signer, domain, msg);
    const tx = await oracle.setFeatureInfo(msg, sig, EIP_712);
    yield ["setFeatureInfo", await tx.wait()];
  }

  {
    const msg = { traitId, words: [] };
    const sig = await sdk.oracle.sign712.addTraitMemberships(
      signer,
      domain,
      msg
    );
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: empty", await tx.wait()];
  }

  const baseTokenId = 23000000;
  let tokenIds = [467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314].map(
    (x) => x + baseTokenId
  );

  {
    const msg = { traitId, words: sdk.oracle.traitMembershipWords(tokenIds) };
    const sig = await sdk.oracle.sign712.addTraitMemberships(
      signer,
      domain,
      msg
    );
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
    const msg = { traitId, words: sdk.oracle.traitMembershipWords(tokenIds) };
    const sig = await sdk.oracle.sign712.addTraitMemberships(
      signer,
      domain,
      msg
    );
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: 256 consecutive", await tx.wait()];
  }

  tokenIds = Array(256)
    .fill()
    .map((_, i) => baseTokenId + 0x0200 + i * 8);
  {
    const msg = { traitId, words: sdk.oracle.traitMembershipWords(tokenIds) };
    const sig = await sdk.oracle.sign712.addTraitMemberships(
      signer,
      domain,
      msg
    );
    const tx = await oracle.addTraitMemberships(msg, sig, EIP_712);
    yield ["addTraitMemberships: 256 semi-scattered", await tx.wait()];
  }
});

TEST_CASES.push(async function* marketFills(props) {
  const signer = props.signers[0];
  const bob = props.signers[1];
  const alice = props.signers[2];
  const exa = BN.from("10").pow(18);
  const chainId = await ethers.provider.send("eth_chainId");
  const market = await props.factories.ArchipelagoMarket.deploy();
  const weth = await props.factories.TestWeth.deploy();
  const token = await props.factories.TestERC721.deploy();
  const oracle = await props.factories.ArtblocksTraitOracle.deploy();
  await Promise.all([
    oracle.deployed(),
    market.deployed(),
    weth.deployed(),
    token.deployed(),
  ]);
  await market.initialize(weth.address, oracle.address);
  const domainInfo = {
    chainId,
    marketAddress: market.address,
    tokenAddress: token.address,
    wethAddress: weth.address,
    traitOracleAddress: oracle.address,
  };

  // Oracle setup
  const domain = {
    oracleAddress: oracle.address,
    chainId,
  };
  await oracle.setOracleSigner(signer.address);
  const projectId = 23;
  const baseTokenId = 23000000;
  let paddleIds = [467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314].map(
    (x) => x + baseTokenId
  );
  const featureName = "Palette: Paddle";
  const version = 0;

  const featureMsg = { projectId, featureName, version };
  const featureSig = await sdk.oracle.sign712.setFeatureInfo(
    signer,
    domain,
    featureMsg
  );
  await oracle.setFeatureInfo(featureMsg, featureSig, EIP_712);

  const traitId = sdk.oracle.featureTraitId(projectId, featureName, version);
  const msg = { traitId, words: sdk.oracle.traitMembershipWords(paddleIds) };
  const sig = await sdk.oracle.sign712.addTraitMemberships(signer, domain, msg);
  await oracle.addTraitMemberships(msg, sig, EIP_712);

  // Token and weth setup
  const tokenId = baseTokenId + 250;
  await token.connect(alice).setApprovalForAll(market.address, true);
  await token.connect(bob).setApprovalForAll(market.address, true);
  await token.mint(alice.address, tokenId);
  await weth.connect(bob).approve(market.address, ethers.constants.MaxUint256);
  await weth
    .connect(alice)
    .approve(market.address, ethers.constants.MaxUint256);
  await weth.connect(alice).deposit({ value: exa.mul(10) });
  await weth.connect(bob).deposit({ value: exa.mul(10) });

  {
    const bid = {
      nonce: 0,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenAddress: token.address,
      tokenId: tokenId,
      traitset: [],
      bidType: BidType.TOKEN_ID,
      royalties: [],
    };
    const ask = {
      nonce: 0,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenAddress: token.address,
      tokenId: tokenId,
      royalties: [],
      unwrapWeth: false,
      authorizedBidder: ethers.constants.AddressZero,
    };
    const bidSignature = sdk.market.sign712.bid(bob, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(alice, domainInfo, ask);
    const tx = await market.fillOrder(
      bid,
      bidSignature,
      EIP_712,
      ask,
      askSignature,
      EIP_712
    );
    yield ["fillSingleTokenOrder", await tx.wait()];
  }

  {
    const bid = {
      nonce: 1,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: 0,
      tokenAddress: token.address,
      traitset: [traitId],
      bidType: BidType.TRAITSET,
      royalties: [],
    };
    const ask = {
      nonce: 1,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      royalties: [],
      unwrapWeth: false,
      authorizedBidder: ethers.constants.AddressZero,
    };
    const bidSignature = sdk.market.sign712.bid(alice, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(bob, domainInfo, ask);
    const tx = await market.fillOrder(
      bid,
      bidSignature,
      EIP_712,
      ask,
      askSignature,
      EIP_712
    );
    yield ["fillSingleTraitsetOrder", await tx.wait()];
  }

  {
    const bid = {
      nonce: 2,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      traitset: [],
      bidType: BidType.TOKEN_ID,
      royalties: [],
    };
    const ask = {
      nonce: 2,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      royalties: [],
      unwrapWeth: true,
      authorizedBidder: ethers.constants.AddressZero,
    };
    const bidSignature = sdk.market.sign712.bid(bob, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(alice, domainInfo, ask);
    const tx = await market.fillOrder(
      bid,
      bidSignature,
      EIP_712,
      ask,
      askSignature,
      EIP_712
    );
    yield ["fillOrder With autoUnwrap", await tx.wait()];
  }

  {
    const r = { recipient: props.signers[0].address, micros: 1000 };
    const bid = {
      nonce: 3,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      traitset: [],
      bidType: BidType.TOKEN_ID,
      royalties: [r, r, r, r],
    };
    const ask = {
      nonce: 3,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      royalties: [],
      unwrapWeth: true,
      authorizedBidder: ethers.constants.AddressZero,
    };
    const bidSignature = sdk.market.sign712.bid(alice, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(bob, domainInfo, ask);
    const tx = await market
      .connect(alice)
      .fillOrderEth(bid, bidSignature, EIP_712, ask, askSignature, EIP_712, {
        value: exa,
      });
    yield ["fillOrder in Eth", await tx.wait()];
  }

  {
    const bid = {
      nonce: 4,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      traitset: [],
      bidType: BidType.TOKEN_ID,
      royalties: [],
    };
    const ask = {
      nonce: 4,
      created: 1,
      deadline: ethers.constants.MaxUint256,
      price: exa,
      tokenId: tokenId,
      tokenAddress: token.address,
      royalties: [],
      unwrapWeth: true,
      authorizedBidder: ethers.constants.AddressZero,
    };
    const bidSignature = sdk.market.sign712.bid(bob, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(alice, domainInfo, ask);
    const tx = await market.fillOrder(
      bid,
      bidSignature,
      EIP_712,
      ask,
      askSignature,
      EIP_712
    );
    yield ["fillOrder with 4 royalties", await tx.wait()];
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
  const [
    ArtblocksTraitOracle,
    ArchipelagoMarket,
    TestTraitOracle,
    TestWeth,
    TestERC721,
  ] = await Promise.all([
    ethers.getContractFactory("ArtblocksTraitOracle"),
    ethers.getContractFactory("ArchipelagoMarket"),
    ethers.getContractFactory("TestTraitOracle"),
    ethers.getContractFactory("TestWeth"),
    ethers.getContractFactory("TestERC721"),
  ]);
  let allPassed = true;
  for (const testCase of TEST_CASES) {
    if (!testCaseMatches(testCase.name)) continue;
    try {
      const gen = testCase({
        factories: {
          ArtblocksTraitOracle,
          ArchipelagoMarket,
          TestTraitOracle,
          TestWeth,
          TestERC721,
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
