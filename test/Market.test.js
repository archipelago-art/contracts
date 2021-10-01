const { expect } = require("chai");
const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const sdk = require("../sdk");
const { SignatureKind } = sdk;

describe("Market", () => {
  const exa = BN.from("10").pow(18);
  let BundleToctouAttacker;
  let Clock;
  let Market;
  let TestWeth;
  let TestERC721;

  let clock;
  before(async () => {
    [
      BundleToctouAttacker,
      Clock,
      Market,
      TestWeth,
      TestERC721,
      TestTraitOracle,
    ] = await Promise.all([
      ethers.getContractFactory("BundleToctouAttacker"),
      ethers.getContractFactory("Clock"),
      ethers.getContractFactory("Market"),
      ethers.getContractFactory("TestWeth"),
      ethers.getContractFactory("TestERC721"),
      ethers.getContractFactory("TestTraitOracle"),
    ]);
    clock = await Clock.deploy();
    await clock.deployed();
  });

  async function domainInfo(market) {
    const chainId = await ethers.provider.send("eth_chainId");
    const tokenAddress = await market.token();
    const wethAddress = await market.weth();
    const traitOracleAddress = await market.traitOracle();
    return { chainId, tokenAddress, wethAddress, traitOracleAddress };
  }

  async function rawDomainSeparator(market) {
    const { name, chainId, salt } = sdk.market.domainSeparator(
      await domainInfo(market)
    );
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "uint256", "bytes32"],
        [
          ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(
              "EIP712Domain(string name,uint256 chainId,bytes32 salt)"
            )
          ),
          ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name)),
          chainId,
          salt,
        ]
      )
    );
  }

  function computeTradeId(bid, bidder, ask, asker) {
    const hash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256", "address", "uint256"],
        [bidder.address, bid.nonce, asker.address, ask.nonce]
      )
    );
    return BN.from(hash);
  }

  async function setup() {
    const signers = await ethers.getSigners();
    const [market, weth, nft, oracle] = await Promise.all([
      Market.deploy(),
      TestWeth.deploy(),
      TestERC721.deploy(),
      TestTraitOracle.deploy(),
    ]);
    await Promise.all([
      market.deployed(),
      weth.deployed(),
      nft.deployed(),
      oracle.deployed(),
    ]);
    await market.initialize(nft.address, weth.address, oracle.address);
    const bidder = signers[1];
    const asker = signers[2];
    const otherSigner = signers[3];
    await weth.connect(bidder).deposit({ value: exa.mul(2) }); // give bidder 2 weth
    await weth
      .connect(bidder)
      .approve(market.address, ethers.constants.MaxUint256);
    // give asker token ids 0 and 1
    await nft.mint(asker.address, 0);
    await nft.mint(asker.address, 1);
    await nft.connect(asker).setApprovalForAll(market.address, true);
    return { signers, market, weth, nft, bidder, asker, otherSigner, oracle };
  }

  it("deploys", async () => {
    const { market } = await setup();
  });

  function tokenIdsBid({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    tokenIds = [0],
    royalties = [],
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenIds,
      traitset: [],
      bidType: sdk.market.BidType.TOKEN_IDS,
      royalties,
    };
  }

  function traitsetBid({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    traitset = [],
    royalties = [],
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenIds: [],
      traitset,
      bidType: sdk.market.BidType.TRAITSET,
      royalties,
    };
  }

  function newAsk({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    tokenIds = [0],
    royalties = [],
    unwrapWeth = false,
    authorizedBidder = ethers.constants.AddressZero,
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenIds,
      royalties,
      unwrapWeth,
      authorizedBidder,
    };
  }

  async function signBid(market, bid, signer) {
    return sdk.market.sign712.bid(signer, await domainInfo(market), bid);
  }

  async function signBidLegacy(market, bid, signer) {
    return sdk.market.signLegacy.bid(signer, await domainInfo(market), bid);
  }

  async function signAsk(market, ask, signer) {
    return sdk.market.sign712.ask(signer, await domainInfo(market), ask);
  }

  async function signAskLegacy(market, ask, signer) {
    return sdk.market.signLegacy.ask(signer, await domainInfo(market), ask);
  }

  async function fillOrder(
    market,
    bid,
    bidder,
    ask,
    asker,
    signatureKinds = {
      bidder: SignatureKind.EIP_712,
      asker: SignatureKind.EIP_712,
    }
  ) {
    let bidSignature, askSignature;
    switch (signatureKinds.bidder) {
      case SignatureKind.NO_SIGNATURE:
        bidSignature = ethers.utils.defaultAbiCoder.encode(
          ["address"],
          [signatureKinds.bidderAddress]
        );
        break;
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        bidSignature = await signBidLegacy(market, bid, bidder);
        break;
      case SignatureKind.EIP_712:
        bidSignature = await signBid(market, bid, bidder);
        break;
      default:
        throw new Error(
          "unexpected signatureKinds.bidder: " + signatureKinds.bidder
        );
    }
    switch (signatureKinds.asker) {
      case SignatureKind.NO_SIGNATURE:
        askSignature = ethers.utils.defaultAbiCoder.encode(
          ["address"],
          [signatureKinds.askerAddress]
        );
        break;
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        askSignature = await signAskLegacy(market, ask, asker);
        break;
      case SignatureKind.EIP_712:
        askSignature = await signAsk(market, ask, asker);
        break;
      default:
        throw new Error(
          "unexpected signatureKinds.asker: " + signatureKinds.asker
        );
    }
    return market.fillOrder(
      bid,
      bidSignature,
      signatureKinds.bidder,
      ask,
      askSignature,
      signatureKinds.asker
    );
  }

  describe("order filling", () => {
    describe("authorization", () => {
      async function expectSuccess(setUpSignatures) {
        const setupData = await setup();
        const { market, signers, weth, nft, asker, bidder } = setupData;
        expect(await nft.ownerOf(0)).to.equal(asker.address);
        expect(await weth.balanceOf(bidder.address)).to.equal(exa.mul(2));
        const bid = tokenIdsBid();
        const ask = newAsk();

        const signatureSetupData = { ...setupData, bid, ask };
        const signatureKinds = await setUpSignatures(signatureSetupData);
        await fillOrder(market, bid, bidder, ask, asker, signatureKinds);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await weth.balanceOf(bidder.address)).to.equal(exa);
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
      }

      it("supports EIP-712 signatures on both ends", async () => {
        await expectSuccess(async () => ({
          bidder: SignatureKind.EIP_712,
          asker: SignatureKind.EIP_712,
        }));
      });
      it("supports legacy signatures on both ends", async () => {
        await expectSuccess(async () => ({
          bidder: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
          asker: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
        }));
      });
      it("supports legacy bid signatures on traitset bids", async () => {
        const { market, signers, weth, nft, asker, bidder, oracle } =
          await setup();
        await oracle.setTrait(0, 42);
        const bid = traitsetBid({ traitset: [42] });
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker, {
          bidder: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
          asker: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
        });
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await weth.balanceOf(bidder.address)).to.equal(exa);
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
      });
      it("supports a legacy bid signature only", async () => {
        await expectSuccess(async () => ({
          bidder: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
          asker: SignatureKind.EIP_712,
        }));
      });
      it("supports a legacy ask signature only", async () => {
        await expectSuccess(async () => ({
          bidder: SignatureKind.EIP_712,
          asker: SignatureKind.ETHEREUM_SIGNED_MESSAGE,
        }));
      });
      it("supports bid and ask approved in contract storage", async () => {
        await expectSuccess(async ({ market, bid, bidder, ask, asker }) => {
          await market.connect(bidder).setOnChainBidApproval(bid, true);
          await market.connect(asker).setOnChainAskApproval(ask, true);
          return {
            bidder: SignatureKind.NO_SIGNATURE,
            asker: SignatureKind.NO_SIGNATURE,
            bidderAddress: bidder.address,
            askerAddress: asker.address,
          };
        });
      });

      it("rejects if asker/bidder is not approved in contract storage", async () => {
        const { market, asker, bidder } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk();

        // do not set on-chain ask approval
        await expect(
          fillOrder(market, bid, bidder, ask, asker, {
            bidder: SignatureKind.EIP_712,
            asker: SignatureKind.NO_SIGNATURE,
            askerAddress: asker.address,
          })
        ).to.be.revertedWith("Market: on-chain approval missing");
      });

      it("rejects if ask is only approved in contract storage by a third party", async () => {
        const { market, asker, bidder, otherSigner } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk();

        await market.connect(otherSigner).setOnChainAskApproval(ask, true);
        await expect(
          fillOrder(market, bid, bidder, ask, asker, {
            bidder: SignatureKind.EIP_712,
            asker: SignatureKind.NO_SIGNATURE,
            askerAddress: asker.address,
          })
        ).to.be.revertedWith("Market: on-chain approval missing");
      });
    });

    describe("bundles", () => {
      it("empty-bundle transactions are allowed", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid({ tokenIds: [] });
        const ask = newAsk({ tokenIds: [] });
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, exa, exa);
      });
      it("multiple tokenId trades succeed", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid({ tokenIds: [0, 1] });
        const ask = newAsk({ tokenIds: [0, 1] });
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, exa, exa)
          .to.emit(market, "TokenTraded")
          .withArgs(tradeId, 0)
          .to.emit(market, "TokenTraded")
          .withArgs(tradeId, 1);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await nft.ownerOf(1)).to.equal(bidder.address);
      });
      it("fails if the bid and ask disagree about token order", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid({ tokenIds: [0, 1] });
        const ask = newAsk({ tokenIds: [1, 0] });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("tokenId mismatch");
      });
      it("fails if the bid and ask disagree about tokens", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid({ tokenIds: [0, 2] });
        const ask = newAsk({ tokenIds: [0, 1] });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("tokenId mismatch");
      });
      it("fails if the second token is transferred while processing the first one", async () => {
        const { market, weth, nft, bidder } = await setup();
        await nft.connect(bidder).setApprovalForAll(market.address, true);

        const token1 = 1001;
        const token2 = 1002;
        const token2Bid = tokenIdsBid({ price: exa, tokenIds: [token2] });
        const config = {
          market: market.address,
          bundleAsk: newAsk({
            nonce: 0,
            price: ethers.constants.Zero,
            tokenIds: [token1, token2],
          }),
          bundleBid: tokenIdsBid({
            nonce: 9,
            price: ethers.constants.Zero,
            tokenIds: [token1, token2],
          }),
          token1,
          token2Ask: newAsk({ nonce: 1, price: exa, tokenIds: [token2] }),
          token2Bid,
          token2Signature: await signBid(market, token2Bid, bidder),
          token2SignatureKind: SignatureKind.EIP_712,
        };

        const attacker = await BundleToctouAttacker.deploy(config);
        await attacker.deployed();

        await nft.mint(attacker.address, token1);
        await nft.mint(attacker.address, token2);

        const attackerAddressSig = ethers.utils.defaultAbiCoder.encode(
          ["address"],
          [attacker.address]
        );

        let orderSucceeded = false;
        try {
          await market.fillOrder(
            config.bundleBid,
            attackerAddressSig,
            SignatureKind.NO_SIGNATURE,
            config.bundleAsk,
            attackerAddressSig,
            SignatureKind.NO_SIGNATURE
          );
          orderSucceeded = true;
        } catch (e) {
          await expect(Promise.reject(e)).to.be.revertedWith(
            "asker is not owner or approved"
          );
        }
        if (orderSucceeded) {
          expect(await nft.ownerOf(token1)).to.equal(attacker.address);
          expect(await nft.ownerOf(token2)).to.equal(attacker.address);
          expect(await weth.balanceOf(attacker.address)).to.equal(exa);
          throw new Error("successfully executed TOCTOU attack");
        }
      });
    });

    describe("authorizedBidder", () => {
      it("allows bids from the ask's authorized bidder", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk({ authorizedBidder: bidder.address });
        await fillOrder(market, bid, bidder, ask, asker);
      });

      it("disallows bids from non-authorized bidders", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk({ authorizedBidder: asker.address });
        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith("bidder is not authorized");
      });
    });
    it("unwraps weth->eth for the asker, if specified", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk({ unwrapWeth: true });
      const askerBalanceBefore = await asker.getBalance();
      await fillOrder(market, bid, bidder, ask, asker);
      expect(await weth.balanceOf(asker.address)).to.equal(0);
      const askerBalanceAfter = await asker.getBalance();
      expect(askerBalanceAfter.sub(askerBalanceBefore)).to.equal(exa);
    });

    it("emits expected events when an order fills", async () => {
      const { market, asker, bidder, signers } = await setup();
      const r0 = signers[3].address;
      const bid = tokenIdsBid({
        royalties: [{ recipient: r0, micros: 1000000 }],
      });
      const ask = newAsk({ royalties: [{ recipient: r0, micros: 500000 }] });
      const tradeId = computeTradeId(bid, bidder, ask, asker);
      await expect(fillOrder(market, bid, bidder, ask, asker))
        .to.emit(market, "Trade")
        .withArgs(
          tradeId,
          bidder.address,
          asker.address,
          bid.price,
          bid.price.div(2),
          bid.price.mul(2)
        )
        .to.emit(market, "TokenTraded")
        .withArgs(tradeId, bid.tokenIds[0]);
    });

    describe("order filling in ETH", () => {
      it("bidder can top-off their weth with eth", async () => {
        const { market, bidder, asker, weth } = await setup();
        const bid = tokenIdsBid({ price: exa.mul(3) });
        const ask = newAsk({ price: exa.mul(3) });
        const bidSignature = await signBid(market, bid, bidder);
        const askSignature = await signAsk(market, ask, asker);
        await market
          .connect(bidder)
          .fillOrderEth(
            bid,
            bidSignature,
            SignatureKind.EIP_712,
            ask,
            askSignature,
            SignatureKind.EIP_712,
            { value: exa }
          );
        expect(await weth.balanceOf(bidder.address)).to.equal(0);
      });
      it("only bidder can call fillOrderEth", async () => {
        const { market, bidder, asker, weth } = await setup();
        const bid = tokenIdsBid({ price: exa.mul(3) });
        const ask = newAsk({ price: exa.mul(3) });
        const bidSignature = await signBid(market, bid, bidder);
        const askSignature = await signAsk(market, ask, asker);
        const fail = market
          .connect(asker)
          .fillOrderEth(
            bid,
            bidSignature,
            SignatureKind.EIP_712,
            ask,
            askSignature,
            SignatureKind.EIP_712,
            { value: exa }
          );
        await expect(fail).to.be.revertedWith("only bidder may fill with ETH");
      });
      it("bidder can over-fill if they choose", async () => {
        const { market, bidder, asker, weth } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk();
        const bidSignature = await signBid(market, bid, bidder);
        const askSignature = await signAsk(market, ask, asker);
        await market
          .connect(bidder)
          .fillOrderEth(
            bid,
            bidSignature,
            SignatureKind.EIP_712,
            ask,
            askSignature,
            SignatureKind.EIP_712,
            {
              value: exa.mul(9),
            }
          );
        expect(await weth.balanceOf(bidder.address)).to.equal(exa.mul(10));
      });
      it("still fails if there's insufficient weth", async () => {
        const { market, bidder, asker, weth } = await setup();
        const bid = tokenIdsBid({ price: exa.mul(10) });
        const ask = newAsk({ price: exa.mul(10) });
        const bidSignature = await signBid(market, bid, bidder);
        const askSignature = await signAsk(market, ask, asker);
        const fail = market
          .connect(bidder)
          .fillOrderEth(
            bid,
            bidSignature,
            SignatureKind.EIP_712,
            ask,
            askSignature,
            SignatureKind.EIP_712,
            {
              value: exa.mul(5),
            }
          );
        await expect(fail).to.be.revertedWith(
          "transfer amount exceeds balance"
        );
      });
    });

    describe("traits and oracle", () => {
      it("any nft can match if the traitset is empty", async () => {
        const { market, bidder, asker } = await setup();
        const bid = traitsetBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker);
      });
      it("a nft can match a single trait", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42] });
        const ask = newAsk();
        await oracle.setTrait(0, 42);
        await fillOrder(market, bid, bidder, ask, asker);
      });
      it("a nft can match a trait intersection", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42, 69] });
        const ask = newAsk();
        await oracle.setTrait(0, 42);
        await oracle.setTrait(0, 69);
        await fillOrder(market, bid, bidder, ask, asker);
      });
      it("a nft can fail to match a single trait", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42] });
        const ask = newAsk();
        await oracle.setTrait(0, 69);
        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith("missing trait");
      });
      it("a nft can fail to match an intersection", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42, 69] });
        const ask = newAsk();
        await oracle.setTrait(0, 69); // it has one trait but not both
        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith("missing trait");
      });
      it("a traitset bid can't match 0 pieces", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42, 69] });
        const ask = newAsk({ tokenIds: [] });
        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "traitset bids only match single-token asks"
        );
      });
      it("a traitset bid can't match multiple pieces", async () => {
        const { market, bidder, asker, oracle } = await setup();
        const bid = traitsetBid({ traitset: [42] });
        const ask = newAsk({ tokenIds: [0, 1] });
        await oracle.setTrait(0, 42);
        await oracle.setTrait(1, 42);
        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "traitset bids only match single-token asks"
        );
      });
    });

    describe("royalties", () => {
      const micro = BN.from("10").pow(12);
      it("handles zero royalties correctly", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdsBid();
        const ask = newAsk({ royalties: [{ recipient: r0, micros: 0 }] });
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await weth.balanceOf(r0)).to.equal(0);
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
      });
      it("handles a single royalty correctly", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdsBid();
        const ask = newAsk({ royalties: [{ recipient: r0, micros: 5 }] });
        const roy = micro.mul(5);
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r0, 5, roy);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa.sub(roy));
      });
      it("handles multiple royalties correctly", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdsBid();
        const ask = newAsk({
          royalties: [
            { recipient: r0, micros: 5 },
            { recipient: r1, micros: 1 },
          ],
        });
        const roy = micro.mul(5);
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        const proceeds = exa.sub(roy).sub(micro);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, proceeds, exa)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r0, 5, roy)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r1, 1, micro);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(r1)).to.equal(micro);
        expect(await weth.balanceOf(asker.address)).to.equal(
          exa.sub(roy).sub(micro)
        );
      });
      it("handles the edge case where royalties sum to 100%", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdsBid();
        const ask = newAsk({
          royalties: [
            { recipient: r0, micros: 800000 },
            { recipient: r1, micros: 200000 },
          ],
        });
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await weth.balanceOf(r0)).to.equal(micro.mul(800000));
        expect(await weth.balanceOf(r1)).to.equal(micro.mul(200000));
        expect(await weth.balanceOf(asker.address)).to.equal(0);
      });
      it("reverts if royalties sum to >100%", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdsBid();
        const ask = newAsk({
          royalties: [
            { recipient: r0, micros: 800000 },
            { recipient: r1, micros: 200001 },
          ],
        });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("Arithmetic operation underflowed");
      });

      it("bidder royalty works (if specified)", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const roy = micro.mul(10);
        const r0 = signers[3].address;
        const bid = tokenIdsBid({ royalties: [{ recipient: r0, micros: 10 }] });
        const ask = newAsk();
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        const cost = exa.add(roy);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, exa, cost)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r0, 10, roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // seller got full price
        expect(await weth.balanceOf(r0)).to.equal(roy); // recipient got "extra"
        expect(await weth.balanceOf(bidder.address)).to.equal(exa.sub(roy)); // bidder started with 2 weth
      });

      it("transaction fails if bidder doesn't have enough for the bidder royalty", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdsBid({
          royalties: [{ recipient: r0, micros: 10 }],
          price: exa.mul(2),
        });
        const ask = newAsk({ price: exa.mul(2) });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("there can be multiple bidder royalties", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdsBid({
          royalties: [
            { recipient: r0, micros: 1 },
            { recipient: r1, micros: 2 },
          ],
        });
        const ask = newAsk();
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r0, 1, micro)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, r1, 2, micro.mul(2));
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
        expect(await weth.balanceOf(r0)).to.equal(micro);
        expect(await weth.balanceOf(r1)).to.equal(micro.mul(2));
        expect(await weth.balanceOf(bidder.address)).to.equal(
          exa.sub(micro.mul(3))
        );
      });
    });

    describe("failure cases", () => {
      // nb: failrues due to cancellation are handled in a separate describe block.
      it("rejects expired bids", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid({ deadline: 0 });
        const ask = newAsk();
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects expired asks", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk({ deadline: 0 });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects if bid and ask disagree about price", async () => {
        const { market, signers, asker, bidder } = await setup();
        const bid = tokenIdsBid({ price: exa.div(2) });
        const ask = newAsk({ price: exa });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("price mismatch");
      });

      it("rejects if bid and ask disagree about tokenId", async () => {
        const { market, signers, asker, bidder } = await setup();
        const bid = tokenIdsBid({ tokenIds: [0] });
        const ask = newAsk({ tokenIds: [1] });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("tokenId mismatch");
      });

      it("rejects if ERC-20 transfer returns `false`", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        await weth.setPaused(true);
        const bid = tokenIdsBid();
        const ask = newAsk();
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("Market: transfer failed");
      });

      it("rejects if ERC-20 transfer returns `false` (in unwrap mode)", async () => {
        const { market, signers, weth, asker, bidder } = await setup();
        await weth.setPaused(true);
        const bid = tokenIdsBid();
        const ask = newAsk({ unwrapWeth: true });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("Market: transfer failed");
      });
    });

    describe("approvals", () => {
      it("rejects if asker lacks approvals", async () => {
        const { market, signers, weth, nft, bidder } = await setup();
        const operator = signers[3];
        const bid = tokenIdsBid();
        const ask = newAsk();
        await expect(
          fillOrder(market, bid, bidder, ask, operator)
        ).to.be.revertedWith("asker is not owner or approved");
      });
      it("works if asker is owner", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const bid = tokenIdsBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // Owner got proceeds
      });
      it("works if asker is approved for all", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const operator = signers[3];
        await nft.connect(asker).setApprovalForAll(operator.address, true);
        const bid = tokenIdsBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, operator);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
      });
      it("works if asker has token approval", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const operator = signers[3];
        await nft.connect(asker).approve(operator.address, 0);
        const bid = tokenIdsBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, operator);
      });
      it("fails if asker has not approved the market (for NFT)", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        nft.connect(asker).setApprovalForAll(market.address, false);
        const bid = tokenIdsBid();
        const ask = newAsk();

        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "ERC721: transfer caller is not owner nor approved"
        );
      });
      it("fails if bidder has not approved the market (for WETH)", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        weth.connect(bidder).approve(market.address, 0);
        const bid = tokenIdsBid();
        const ask = newAsk();

        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "ERC20: transfer amount exceeds allowance"
        );
      });
      it("succeeds if asker has approved the token specifically", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        nft.connect(asker).setApprovalForAll(market.address, false);
        nft.connect(asker).approve(market.address, 0);
        const bid = tokenIdsBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
      });

      it("when asker is approved not owner, asker still gets WETH proceeds", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          asker: owner,
        } = await setup();
        const operator = signers[3];
        await nft.connect(owner).setApprovalForAll(operator.address, true);
        const bid = tokenIdsBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, operator);
        expect(await weth.balanceOf(owner.address)).to.equal(0);
        expect(await weth.balanceOf(operator.address)).to.equal(exa);
      });

      it("when asker is approved not owner, asker still gets ETH proceeds", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          asker: owner,
        } = await setup();
        const operator = signers[3];
        await nft.connect(owner).setApprovalForAll(operator.address, true);
        const bid = tokenIdsBid();
        const ask = newAsk({ unwrapWeth: true });
        const balanceBefore = await operator.getBalance();
        const ownerBalanceBefore = await owner.getBalance();
        await fillOrder(market, bid, bidder, ask, operator);
        const balanceAfter = await operator.getBalance();
        expect(balanceAfter.sub(balanceBefore)).to.equal(exa);
        expect(await owner.getBalance()).to.equal(ownerBalanceBefore);
      });
    });
  });
  describe("cancellation mechanics", () => {
    it("orders may fail due to bid timestamp cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk();
      await market.connect(bidder).cancelBids(bid.created);
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to ask timestamp cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk();
      await market.connect(asker).cancelAsks(ask.created);
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to bid nonce cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk();
      await market.connect(bidder).cancelNonces([bid.nonce]);
      expect(
        await market.nonceCancellation(bidder.address, bid.nonce)
      ).to.equal(true);
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to ask nonce cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk();
      await market.connect(asker).cancelNonces([ask.nonce]);
      expect(await market.nonceCancellation(asker.address, ask.nonce)).to.equal(
        true
      );
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("multiple nonces may be cancelled in a single tx", async () => {
      const { market, signers } = await setup();
      const operator = signers[0];
      await market.cancelNonces([420, 69]);
      expect(await market.nonceCancellation(operator.address, 420)).to.equal(
        true
      );
      expect(await market.nonceCancellation(operator.address, 69)).to.equal(
        true
      );
    });
    it("fills result in cancellation of any other bids/asks with same nonce", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdsBid();
      const ask = newAsk();
      await fillOrder(market, bid, bidder, ask, asker);
      expect(
        await market.nonceCancellation(bidder.address, bid.nonce)
      ).to.equal(true);
      expect(await market.nonceCancellation(asker.address, ask.nonce)).to.equal(
        true
      );
    });
    it("events are emitted on all cancellation types", async () => {
      const { market, signers } = await setup();
      const address = signers[0].address;
      const cancelBids = market.cancelBids(100);
      await expect(cancelBids)
        .to.emit(market, "BidCancellation")
        .withArgs(address, 100);
      const cancelAsks = market.cancelAsks(101);
      await expect(cancelAsks)
        .to.emit(market, "AskCancellation")
        .withArgs(address, 101);
      const cancelNonces = market.cancelNonces([102, 103]);
      await expect(cancelNonces)
        .to.emit(market, "NonceCancellation")
        .withArgs(address, 102)
        .to.emit(market, "NonceCancellation")
        .withArgs(address, 103);
    });
    it("cancellation timestamps must be increasing", async () => {
      const { market } = await setup();
      await market.cancelBids(1);
      await market.cancelAsks(1);
      await expect(market.cancelBids(0)).to.be.revertedWith("invalid args");
      await expect(market.cancelBids(1)).to.be.revertedWith("invalid args");
      await expect(market.cancelAsks(0)).to.be.revertedWith("invalid args");
      await expect(market.cancelAsks(1)).to.be.revertedWith("invalid args");
    });
    it("cancellation timestamps must not be in the future", async () => {
      const { market } = await setup();
      const now = await clock.timestamp();
      const future = now.add(BN.from("86400"));
      await expect(market.cancelBids(future)).to.be.revertedWith(
        "invalid args"
      );
      await expect(market.cancelAsks(future)).to.be.revertedWith(
        "invalid args"
      );
    });
  });
  describe("EIP-712 struct hash helpers", () => {
    it("properly hash bids", async () => {
      const { market, signers, bidder } = await setup();
      const bid = traitsetBid({
        nonce: 1,
        created: 2,
        deadline: ethers.constants.MaxUint256,
        price: exa,
        traitset: [0x1234, 0x5678],
        royalties: [
          { recipient: signers[3].address, micros: 10 },
          { recipient: signers[4].address, micros: 100 },
        ],
      });
      const hash = await market.bidHash(bid);
      const addr = bidder.address;
      expect(await market.onChainApprovals(addr, hash)).to.equal(false);
      await expect(
        market.connect(bidder).setOnChainBidApproval(bid, true)
      ).to.emit(market, "BidApproval");
      expect(await market.onChainApprovals(addr, hash)).to.equal(true);
      await expect(
        market.connect(bidder).setOnChainBidApproval(bid, false)
      ).to.emit(market, "BidApproval");
      expect(await market.onChainApprovals(addr, hash)).to.equal(false);
    });
    it("properly hash asks", async () => {
      const { market, signers, asker } = await setup();
      const ask = newAsk({
        nonce: 1,
        created: 2,
        deadline: ethers.constants.MaxUint256,
        tokenId: 0x12345678,
        price: exa,
        royalties: [
          { recipient: signers[3].address, micros: 10 },
          { recipient: signers[4].address, micros: 100 },
        ],
      });
      const hash = await market.askHash(ask);
      const addr = asker.address;
      expect(await market.onChainApprovals(addr, hash)).to.equal(false);
      await expect(
        market.connect(asker).setOnChainAskApproval(ask, true)
      ).to.emit(market, "AskApproval");
      expect(await market.onChainApprovals(addr, hash)).to.equal(true);
      await expect(
        market.connect(asker).setOnChainAskApproval(ask, false)
      ).to.emit(market, "AskApproval");
      expect(await market.onChainApprovals(addr, hash)).to.equal(false);
    });
  });
  it("rejects ether transfers that are not from the weth contract", async () => {
    const { market, signers } = await setup();
    const fail = signers[0].sendTransaction({ to: market.address, value: exa });
    await expect(fail).to.be.revertedWith("only weth contract may pay");
  });
});
