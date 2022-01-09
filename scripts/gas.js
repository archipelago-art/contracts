const hre = require("hardhat");
const { ethers } = hre;

const BN = ethers.BigNumber;

const sdk = require("../sdk");
const { EIP_712 } = sdk.SignatureKind;

const TEST_CASES = [];

TEST_CASES.push(async function* marketDeploy(props) {
  const market = await props.factories.ArchipelagoMarket.deploy();
  await market.deployed();
  yield ["Market deploy", await market.deployTransaction.wait()];
});

TEST_CASES.push(async function* oracleDeploy(props) {
  const oracle = await props.factories.ArtblocksOracle.deploy();
  await oracle.deployed();
  yield ["ArtblocksOracle deploy", await oracle.deployTransaction.wait()];
});

TEST_CASES.push(async function* circuitOracleDeploy(props) {
  const oracle = await props.factories.CircuitOracle.deploy();
  await oracle.deployed();
  yield ["CircuitOracle deploy", await oracle.deployTransaction.wait()];
});

TEST_CASES.push(async function* oracleTraitMemberships(props) {
  const oracle = await props.factories.ArtblocksOracle.deploy();
  await oracle.deployed();
  const signer = props.signers[0];
  await oracle.setOracleSigner(signer.address);

  const projectId = 23;
  const featureName = "Palette: Paddle";
  const version = 0;
  const traitId = sdk.artblocks.featureTraitId(projectId, featureName, version);
  const domain = {
    oracleAddress: oracle.address,
    chainId: await ethers.provider.send("eth_chainId"),
  };
  const tokenContract = "0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270";

  {
    const msg = { projectId, featureName, version, tokenContract };
    const sig = await sdk.artblocks.sign712.setFeatureInfo(signer, domain, msg);
    const tx = await oracle.setFeatureInfo(msg, sig, EIP_712);
    yield ["setFeatureInfo", await tx.wait()];
  }

  {
    const msg = sdk.artblocks.updateTraitMessage({
      traitId,
      words: [],
    });
    const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
    const tx = await oracle.updateTrait(msg, sig, EIP_712);
    yield ["updateTrait: empty", await tx.wait()];
  }

  const baseTokenId = 23000000;
  let tokenIds = [467, 36, 45, 3, 70, 237, 449, 491, 135, 54, 250, 314].map(
    (x) => x + baseTokenId
  );

  {
    const msg = sdk.artblocks.updateTraitMessage({ traitId, tokenIds });
    const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
    const tx1 = await oracle.updateTrait(msg, sig, EIP_712);
    yield [`updateTrait: Paddle (${tokenIds.length})`, await tx1.wait()];
    const tx2 = await oracle.updateTrait(msg, sig, EIP_712);
    yield ["updateTrait: Paddle again (no-op)", await tx2.wait()];
  }

  tokenIds = Array(256)
    .fill()
    .map((_, i) => baseTokenId + 0x0100 + i);
  {
    const msg = sdk.artblocks.updateTraitMessage({ traitId, tokenIds });
    const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
    const tx = await oracle.updateTrait(msg, sig, EIP_712);
    yield ["updateTrait: 256 consecutive", await tx.wait()];
  }

  tokenIds = Array(256)
    .fill()
    .map((_, i) => baseTokenId + 0x0200 + i * 8);
  {
    const msg = sdk.artblocks.updateTraitMessage({ traitId, tokenIds });
    const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
    const tx = await oracle.updateTrait(msg, sig, EIP_712);
    yield ["updateTrait: 256 semi-scattered", await tx.wait()];
  }
});

TEST_CASES.push(async function* marketFills(props) {
  const signer = props.signers[0];
  const bob = props.signers[1];
  const alice = props.signers[2];
  const exa = BN.from("10").pow(18);
  const chainId = await ethers.provider.send("eth_chainId");
  const market = await props.factories.ArchipelagoMarket.deploy();
  await market.setArchipelagoRoyaltyRate(5000);
  await market.setTreasuryAddress(signer.address);

  const weth = await props.factories.TestWeth.deploy();
  const token = await props.factories.TestERC721.deploy();
  const oracle = await props.factories.ArtblocksOracle.deploy();
  const circuitOracle = await props.factories.CircuitOracle.deploy();
  await Promise.all([
    oracle.deployed(),
    circuitOracle.deployed(),
    market.deployed(),
    weth.deployed(),
    token.deployed(),
  ]);
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
  const unsetFeatureName = "Palette: Blue Spider";
  const version = 0;

  const projectMsg = {
    projectId,
    size: 600,
    projectName: "Archetype",
    version,
    tokenContract: token.address,
  };
  const projectSig = await sdk.artblocks.sign712.setProjectInfo(
    signer,
    domain,
    projectMsg
  );
  await oracle.setProjectInfo(projectMsg, projectSig, EIP_712);

  const featureMsg = {
    projectId,
    featureName,
    version,
    tokenContract: token.address,
  };
  const featureSig = await sdk.artblocks.sign712.setFeatureInfo(
    signer,
    domain,
    featureMsg
  );
  await oracle.setFeatureInfo(featureMsg, featureSig, EIP_712);

  const projectTraitId = sdk.artblocks.projectTraitId(projectId, version);
  const traitId = sdk.artblocks.featureTraitId(projectId, featureName, version);
  const unsetTraitId = sdk.artblocks.featureTraitId(
    projectId,
    unsetFeatureName,
    version
  );

  const msg = sdk.artblocks.updateTraitMessage({
    traitId,
    tokenIds: paddleIds,
  });
  const sig = await sdk.artblocks.sign712.updateTrait(signer, domain, msg);
  await oracle.updateTrait(msg, sig, EIP_712);

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
  // give signer (future royalty recipient) some eth so that when we are measuring gas,
  // we don't include paying for storing the fact that signer has a non-zero weth balance.
  await weth.connect(signer).deposit({ value: exa });

  async function transferToken(from, to) {
    await token
      .connect(from)
      ["safeTransferFrom(address,address,uint256)"](
        from.address,
        to.address,
        tokenId
      );
  }

  let nextNonce = 0;

  function newBid({
    nonce = nextNonce++,
    deadline = sdk.market.MaxUint40,
    currencyAddress = weth.address,
    price = exa,
    tokenAddress = token.address,
    requiredRoyalties = [],
    extraRoyalties = [],
    traitOracle = ethers.constants.AddressZero,
    trait = tokenId,
  } = {}) {
    return {
      nonce,
      deadline,
      currencyAddress,
      price,
      tokenAddress,
      requiredRoyalties,
      extraRoyalties,
      trait: ethers.utils.isBytesLike(trait)
        ? trait
        : ethers.utils.defaultAbiCoder.encode(["uint256"], [trait]),
      traitOracle,
    };
  }

  const defaultTokenId = tokenId;
  function newAsk({
    nonce = nextNonce++,
    deadline = sdk.market.MaxUint40,
    currencyAddress = weth.address,
    price = exa,
    tokenAddress = token.address,
    tokenId = defaultTokenId,
    requiredRoyalties = [],
    extraRoyalties = [],
    unwrapWeth = false,
    authorizedBidder = ethers.constants.AddressZero,
  } = {}) {
    return {
      nonce,
      deadline,
      currencyAddress,
      price,
      tokenAddress,
      tokenId,
      requiredRoyalties,
      extraRoyalties,
      unwrapWeth,
      authorizedBidder,
    };
  }

  {
    const bid = newBid();
    const ask = newAsk();
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
    const bid = newBid({ trait: traitId, traitOracle: oracle.address });
    const ask = newAsk();
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
    yield ["fillOrder with single feature trait", await tx.wait()];
    await transferToken(alice, bob); // give it back
  }

  {
    const disjunctionTraitId = sdk.circuit.encodeTrait({
      underlyingOracle: oracle.address,
      baseTraits: [traitId, unsetTraitId],
      ops: [{ type: "OR", arg0: 0, arg1: 1 }],
    });
    const bid = newBid({
      trait: disjunctionTraitId,
      traitOracle: circuitOracle.address,
    });
    const ask = newAsk();
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
    yield ["fillOrder with union of two feature traits", await tx.wait()];
    await transferToken(alice, bob); // give it back
  }

  {
    const conjunctionTraitId = sdk.circuit.encodeTrait({
      underlyingOracle: oracle.address,
      baseTraits: [projectTraitId, traitId],
      ops: [{ type: "AND", arg0: 0, arg1: 1 }],
    });
    const bid = newBid({
      trait: conjunctionTraitId,
      traitOracle: circuitOracle.address,
    });
    const ask = newAsk();
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
    yield [
      "fillOrder with intersection of project and feature traits",
      await tx.wait(),
    ];
  }

  {
    const bid = newBid();
    const ask = newAsk({ unwrapWeth: true });
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
    const bid = newBid();
    const ask = newAsk();
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
    const r0 = { recipient: signer.address, micros: 10000 };
    const bid = newBid({ requiredRoyalties: [r0] });
    const ask = newAsk({ requiredRoyalties: [r0] });
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
    yield ["fill with 1 royalty", await tx.wait()];
  }

  {
    const r0 = { recipient: signer.address, micros: 10000 };
    const bid = newBid({ requiredRoyalties: [r0, r0, r0] });
    const ask = newAsk({ requiredRoyalties: [r0, r0, r0] });
    const bidSignature = sdk.market.sign712.bid(alice, domainInfo, bid);
    const askSignature = sdk.market.sign712.ask(bob, domainInfo, ask);
    await market.set;
    const tx = await market.fillOrder(
      bid,
      bidSignature,
      EIP_712,
      ask,
      askSignature,
      EIP_712
    );
    yield ["standard fill (3 royalties + protocol roy)", await tx.wait()];
  }

  {
    const tx = await market.cancelNonces([999]);
    yield ["cancel 1 nonce", await tx.wait()];
  }
  {
    const nonces = [];
    for (let i = 0; i < 20; i++) {
      nonces.push(i + 1000);
    }
    const tx = await market.cancelNonces(nonces);
    yield ["cancel 20 nonces", await tx.wait()];
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
    ArtblocksOracle,
    ArchipelagoMarket,
    CircuitOracle,
    TestTraitOracle,
    TestWeth,
    TestERC721,
  ] = await Promise.all([
    ethers.getContractFactory("ArtblocksOracle"),
    ethers.getContractFactory("ArchipelagoMarket"),
    ethers.getContractFactory("CircuitOracle"),
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
          ArtblocksOracle,
          ArchipelagoMarket,
          CircuitOracle,
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
