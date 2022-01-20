const { expect } = require("chai");
const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const sdk = require("../sdk");
const { SignatureKind } = sdk;

describe("Market", () => {
  const exa = BN.from("10").pow(18);
  let Clock;
  let Market;
  let TestWeth;
  let TestERC721;
  let TestERC20;

  let clock;
  before(async () => {
    [Clock, Market, TestWeth, TestERC721, TestTraitOracle, TestERC20] =
      await Promise.all([
        ethers.getContractFactory("Clock"),
        ethers.getContractFactory("ArchipelagoMarket"),
        ethers.getContractFactory("TestWeth"),
        ethers.getContractFactory("TestERC721"),
        ethers.getContractFactory("TestTraitOracle"),
        ethers.getContractFactory("TestERC20"),
      ]);
    clock = await Clock.deploy();
    await clock.deployed();
  });

  async function domainInfo(market) {
    const chainId = await ethers.provider.send("eth_chainId");
    const marketAddress = market.address;
    return {
      chainId,
      marketAddress,
    };
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

    function newAgreement({
      currencyAddress = weth.address,
      price = exa,
      tokenAddress = nft.address,
      requiredRoyalties = [],
    } = {}) {
      return {
        currencyAddress,
        price,
        tokenAddress,
        requiredRoyalties,
      };
    }

    function tokenIdBid({
      nonce = 0,
      deadline = sdk.market.MaxUint40,
      extraRoyalties = [],
      tokenId = 0,
      agreement = null,
    } = {}) {
      if (agreement == null) {
        agreement = newAgreement();
      }
      return {
        agreementHash: sdk.market.hash.orderAgreement(agreement),
        nonce,
        deadline,
        extraRoyalties,
        trait: ethers.utils.defaultAbiCoder.encode(["uint256"], [tokenId]),
        traitOracle: ethers.constants.AddressZero,
      };
    }

    function traitBid({
      nonce = 0,
      deadline = sdk.market.MaxUint40,
      extraRoyalties = [],
      trait = 0,
      traitOracle = oracle.address,
      agreement = null,
    } = {}) {
      if (agreement == null) {
        agreement = newAgreement();
      }
      return {
        agreementHash: sd.market.hash.orderAgreement(agreement),
        nonce,
        deadline,
        extraRoyalties,
        trait: ethers.utils.isBytesLike(trait)
          ? trait
          : ethers.utils.defaultAbiCoder.encode(["uint256"], [trait]),
        traitOracle,
      };
    }

    function newAsk({
      nonce = 0,
      deadline = sdk.market.MaxUint40,
      agreement = null,
      tokenId = 0,
      extraRoyalties = [],
      unwrapWeth = false,
      authorizedBidder = ethers.constants.AddressZero,
    } = {}) {
      if (agreement == null) {
        agreement = newAgreement();
      }
      return {
        agreementHash: sdk.market.hash.orderAgreement(agreement),
        nonce,
        deadline,
        tokenId,
        extraRoyalties,
        unwrapWeth,
        authorizedBidder,
      };
    }
    return {
      signers,
      market,
      weth,
      nft,
      bidder,
      asker,
      otherSigner,
      oracle,
      tokenIdBid,
      traitBid,
      newAsk,
      newAgreement,
    };
  }

  it("deploys", async () => {
    const { market } = await setup();
  });

  async function signBid(market, bid, signer) {
    return sdk.market.sign.bid(
      SignatureKind.EIP_712,
      signer,
      await domainInfo(market),
      bid
    );
  }

  async function signBidLegacy(market, bid, signer) {
    return sdk.market.sign.bid(
      SignatureKind.ETHEREUM_SIGNED_MESSAGE,
      signer,
      await domainInfo(market),
      bid
    );
  }

  async function signAsk(market, ask, signer) {
    return sdk.market.sign.ask(
      SignatureKind.EIP_712,
      signer,
      await domainInfo(market),
      ask
    );
  }

  async function signAskLegacy(market, ask, signer) {
    return sdk.market.sign.ask(
      SignatureKind.ETHEREUM_SIGNED_MESSAGE,
      signer,
      await domainInfo(market),
      ask
    );
  }

  async function fillOrder(
    market,
    agreement,
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
      agreement,
      bid,
      bidSignature,
      signatureKinds.bidder,
      ask,
      askSignature,
      signatureKinds.asker
    );
  }

  describe("SDK signature verification", () => {
    let market, signers;
    before(async () => {
      signers = await ethers.getSigners();
      market = await Market.deploy();
    });

    it("verifies EIP-712 bid signatures", async () => {
      const bidder = signers[1];
      const { tokenIdBid } = await setup();
      const bid = tokenIdBid();
      const signature = await signBid(market, bid, bidder);
      expect(
        sdk.market.verify.bid(
          SignatureKind.EIP_712,
          signature,
          await domainInfo(market),
          bid
        )
      ).to.equal(bidder.address);
    });

    it("verifies EIP-712 ask signatures", async () => {
      const asker = signers[1];
      const { newAsk } = await setup();
      const ask = newAsk();
      const signature = await signAsk(market, ask, asker);
      expect(
        sdk.market.verify.ask(
          SignatureKind.EIP_712,
          signature,
          await domainInfo(market),
          ask
        )
      ).to.equal(asker.address);
    });

    it("verifies legacy bid signatures", async () => {
      const bidder = signers[1];
      const { tokenIdBid } = await setup();
      const bid = tokenIdBid();
      const signature = await signBidLegacy(market, bid, bidder);
      expect(
        sdk.market.verify.bid(
          SignatureKind.ETHEREUM_SIGNED_MESSAGE,
          signature,
          await domainInfo(market),
          bid
        )
      ).to.equal(bidder.address);
    });

    it("verifies legacy ask signatures", async () => {
      const asker = signers[1];
      const { newAsk } = await setup();
      const ask = newAsk();
      const signature = await signAskLegacy(market, ask, asker);
      expect(
        sdk.market.verify.ask(
          SignatureKind.ETHEREUM_SIGNED_MESSAGE,
          signature,
          await domainInfo(market),
          ask
        )
      ).to.equal(asker.address);
    });
  });

  describe("order filling", () => {
    describe.only("authorization", () => {
      async function expectSuccess(setUpSignatures) {
        const setupData = await setup();
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = setupData;
        expect(await nft.ownerOf(0)).to.equal(asker.address);
        expect(await weth.balanceOf(bidder.address)).to.equal(exa.mul(2));
        const bid = tokenIdBid();
        const ask = newAsk();

        const signatureSetupData = { ...setupData, bid, ask };
        const signatureKinds = await setUpSignatures(signatureSetupData);
        await fillOrder(
          market,
          newAgreement(),
          bid,
          bidder,
          ask,
          asker,
          signatureKinds
        );
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
      it("supports legacy bid signatures on trait bids", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          oracle,
          traitBid,
          newAsk,
          newAgreement,
        } = await setup();
        await oracle.setTrait(nft.address, 0, "0x42");
        const bid = traitBid({ trait: "0x42" });
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker, {
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
        const { market, asker, bidder, tokenIdBid, newAsk, newAgreement } =
          await setup();
        const bid = tokenIdBid();
        const ask = newAsk();

        // do not set on-chain ask approval
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker, {
            bidder: SignatureKind.EIP_712,
            asker: SignatureKind.NO_SIGNATURE,
            askerAddress: asker.address,
          })
        ).to.be.revertedWith("Market: on-chain approval missing");
      });

      it("rejects if ask is only approved in contract storage by a third party", async () => {
        const {
          market,
          asker,
          bidder,
          otherSigner,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk();

        await market.connect(otherSigner).setOnChainAskApproval(ask, true);
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker, {
            bidder: SignatureKind.EIP_712,
            asker: SignatureKind.NO_SIGNATURE,
            askerAddress: asker.address,
          })
        ).to.be.revertedWith("Market: on-chain approval missing");
      });
    });

    describe("authorizedBidder", () => {
      it("allows bids from the ask's authorized bidder", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk({ authorizedBidder: bidder.address });
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      });

      it("disallows bids from non-authorized bidders", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk({ authorizedBidder: asker.address });
        const fail = fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith("bidder is not authorized");
      });
    });
    it("unwraps weth->eth for the asker, if specified", async () => {
      const {
        market,
        signers,
        weth,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk({ unwrapWeth: true });
      const askerBalanceBefore = await asker.getBalance();
      await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      expect(await weth.balanceOf(asker.address)).to.equal(0);
      const askerBalanceAfter = await asker.getBalance();
      expect(askerBalanceAfter.sub(askerBalanceBefore)).to.equal(exa);
    });
    it("allows using a currency that is not weth", async () => {
      const {
        market,
        signers,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const currency = await TestERC20.deploy();
      await currency.deployed();
      await currency.mint(bidder.address, exa);
      await currency
        .connect(bidder)
        .approve(market.address, ethers.constants.MaxUint256);
      const bid = tokenIdBid({ currencyAddress: currency.address });
      const ask = newAsk({
        currencyAddress: currency.address,
      });
      await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      expect(await currency.balanceOf(asker.address)).to.equal(exa);
      expect(await currency.balanceOf(bidder.address)).to.equal(0);
    });
    it("fails if the currency is not weth and the asker wants weth unwrapped", async () => {
      const {
        market,
        signers,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const currency = await TestERC20.deploy();
      await currency.deployed();
      await currency.mint(bidder.address, exa);
      await currency
        .connect(bidder)
        .approve(market.address, ethers.constants.MaxUint256);
      const agreement = newAgreement({ currencyAddress: currency.address });
      const bid = tokenIdBid({ agreement });
      const ask = newAsk({
        agreement,
        unwrapWeth: true,
      });
      await expect(
        fillOrder(market, newAgreement(), bid, bidder, ask, asker)
      ).to.be.revertedWith("function selector was not recognized");
    });

    it("emits expected events when an order fills", async () => {
      const {
        market,
        asker,
        bidder,
        signers,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const r0 = signers[3].address;
      const bid = tokenIdBid({
        extraRoyalties: [{ recipient: r0, micros: 1000000 }],
      });
      const ask = newAsk({
        extraRoyalties: [{ recipient: r0, micros: 500000 }],
      });
      const tradeId = computeTradeId(bid, bidder, ask, asker);
      await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
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
        .withArgs(tradeId, bid.tokenAddress, bid.trait);
    });

    describe("order filling in ETH", () => {
      it("bidder can top-off their weth with eth", async () => {
        const {
          market,
          bidder,
          asker,
          weth,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ price: exa.mul(3) });
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
      it("filling with eth fails if the currency is not weth", async () => {
        const { market, bidder, asker, tokenIdBid, newAsk, newAgreement } =
          await setup();
        const currency = await TestERC20.deploy();
        await currency.deployed();
        const bid = tokenIdBid({
          price: exa,
          currencyAddress: currency.address,
        });
        const ask = newAsk({ price: exa, currencyAddress: currency.address });
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
            { value: exa }
          );
        await expect(fail).to.be.revertedWith(
          "function selector was not recognized"
        );
      });
      it("only bidder can call fillOrderEth", async () => {
        const {
          market,
          bidder,
          asker,
          weth,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ price: exa.mul(3) });
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
        const {
          market,
          bidder,
          asker,
          weth,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid();
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
        const {
          market,
          bidder,
          asker,
          weth,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ price: exa.mul(10) });
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
      it("a nft can match a single trait", async () => {
        const { market, bidder, asker, oracle, traitBid, newAsk, nft } =
          await setup();
        const bid = traitBid({ trait: "0x42" });
        const ask = newAsk();
        await oracle.setTrait(nft.address, 0, "0x42");
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      });
      it("a nft can fail to match a single trait", async () => {
        const { market, bidder, asker, oracle, traitBid, newAsk, nft } =
          await setup();
        const bid = traitBid({ trait: "0x42" });
        const ask = newAsk();
        await oracle.setTrait(nft.address, 0, 69);
        const fail = fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith("missing trait");
      });
    });

    describe("royalties", () => {
      const micro = BN.from("10").pow(12);
      it("handles zero royalties correctly", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdBid({
          requiredRoyalties: [{ recipient: r0, micros: 0 }],
        });
        const ask = newAsk({
          requiredRoyalties: [{ recipient: r0, micros: 0 }],
        });
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        expect(await weth.balanceOf(r0)).to.equal(0);
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
      });
      it("handles a single required royalty correctly", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdBid({
          requiredRoyalties: [{ recipient: r0, micros: 5 }],
        });
        const ask = newAsk({
          requiredRoyalties: [{ recipient: r0, micros: 5 }],
        });
        const roy = micro.mul(5);
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r0, 5, roy);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa.sub(roy));
      });
      it("handles multiple required royalties correctly", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdBid({
          requiredRoyalties: [
            { recipient: r0, micros: 5 },
            { recipient: r1, micros: 1 },
          ],
        });
        const ask = newAsk({
          requiredRoyalties: [
            { recipient: r0, micros: 5 },
            { recipient: r1, micros: 1 },
          ],
        });
        const roy = micro.mul(5);
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        const proceeds = exa.sub(roy).sub(micro);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, proceeds, exa)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r0, 5, roy)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r1, 1, micro);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(r1)).to.equal(micro);
        expect(await weth.balanceOf(asker.address)).to.equal(
          exa.sub(roy).sub(micro)
        );
      });
      it("handles the edge case where royalties sum to 100%", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdBid({
          requiredRoyalties: [{ recipient: r0, micros: 800000 }],
        });
        const ask = newAsk({
          requiredRoyalties: [{ recipient: r0, micros: 800000 }],
          extraRoyalties: [{ recipient: r1, micros: 200000 }],
        });
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        expect(await weth.balanceOf(r0)).to.equal(micro.mul(800000));
        expect(await weth.balanceOf(r1)).to.equal(micro.mul(200000));
        expect(await weth.balanceOf(asker.address)).to.equal(0);
      });
      it("reverts if royalties sum to >100%", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdBid({
          requiredRoyalties: [{ recipient: r0, micros: 800000 }],
        });
        const ask = newAsk({
          requiredRoyalties: [{ recipient: r0, micros: 800000 }],
          extraRoyalties: [{ recipient: r1, micros: 200001 }],
        });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("Arithmetic operation underflowed");
      });

      it("bidder extra royalty works (if specified)", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const roy = micro.mul(10);
        const r0 = signers[3].address;
        const bid = tokenIdBid({
          extraRoyalties: [{ recipient: r0, micros: 10 }],
        });
        const ask = newAsk();
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        const cost = exa.add(roy);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "Trade")
          .withArgs(tradeId, bidder.address, asker.address, exa, exa, cost)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, bidder.address, r0, 10, roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // seller got full price
        expect(await weth.balanceOf(r0)).to.equal(roy); // recipient got "extra"
        expect(await weth.balanceOf(bidder.address)).to.equal(exa.sub(roy)); // bidder started with 2 weth
      });

      it("asker extra royalty works (if specified)", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdBid();
        const ask = newAsk({ extraRoyalties: [{ recipient: r0, micros: 5 }] });
        const roy = micro.mul(5);
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r0, 5, roy);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa.sub(roy));
      });

      it("all three royalty types in conjunction", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bidderStartBalance = await weth.balanceOf(bidder.address);
        const r1 = signers[3].address;
        const r2 = signers[4].address;
        const r3 = signers[5].address;
        const bid = tokenIdBid({
          requiredRoyalties: [{ recipient: r1, micros: 1 }],
          extraRoyalties: [{ recipient: r2, micros: 2 }],
        });
        const ask = newAsk({
          requiredRoyalties: [{ recipient: r1, micros: 1 }],
          extraRoyalties: [{ recipient: r3, micros: 3 }],
        });
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r1, 1, micro)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, bidder.address, r2, 2, micro.mul(2))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r3, 3, micro.mul(3));
        expect(await weth.balanceOf(r1)).to.equal(micro);
        expect(await weth.balanceOf(r2)).to.equal(micro.mul(2));
        expect(await weth.balanceOf(r3)).to.equal(micro.mul(3));
        expect(await weth.balanceOf(asker.address)).to.equal(
          exa.sub(micro.mul(4))
        );
        expect(await weth.balanceOf(bidder.address)).to.equal(
          bidderStartBalance.sub(bid.price).sub(micro.mul(2))
        );
      });

      it("transaction fails if bidder doesn't have enough for the bidder royalty", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const bid = tokenIdBid({
          extraRoyalties: [{ recipient: r0, micros: 10 }],
          price: exa.mul(2),
        });
        const ask = newAsk({ price: exa.mul(2) });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("there can be multiple bidder royalties", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const r0 = signers[3].address;
        const r1 = signers[4].address;
        const bid = tokenIdBid({
          extraRoyalties: [
            { recipient: r0, micros: 1 },
            { recipient: r1, micros: 2 },
          ],
        });
        const ask = newAsk();
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, bidder.address, r0, 1, micro)
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, bidder.address, r1, 2, micro.mul(2));
        expect(await weth.balanceOf(asker.address)).to.equal(exa);
        expect(await weth.balanceOf(r0)).to.equal(micro);
        expect(await weth.balanceOf(r1)).to.equal(micro.mul(2));
        expect(await weth.balanceOf(bidder.address)).to.equal(
          exa.sub(micro.mul(3))
        );
      });

      describe("required royalty matching", () => {
        it("errors if required royalties are a different length", async () => {
          const {
            market,
            signers,
            weth,
            asker,
            bidder,
            tokenIdBid,
            newAsk,
            newAgreement,
          } = await setup();
          const bid = tokenIdBid({
            requiredRoyalties: [{ recipient: bidder.address, micros: 10 }],
          });
          const ask = newAsk();
          await expect(
            fillOrder(market, newAgreement(), bid, bidder, ask, asker)
          ).to.be.revertedWith("Market: required royalties don't match");
        });
        it("errors if required royalties disagree on a recipient", async () => {
          const { market, asker, bidder, tokenIdBid, newAsk, newAgreement } =
            await setup();
          const bid = tokenIdBid({
            requiredRoyalties: [{ recipient: bidder.address, micros: 10 }],
          });
          const ask = newAsk({
            requiredRoyalties: [{ recipient: asker.address, micros: 10 }],
          });
          await expect(
            fillOrder(market, newAgreement(), bid, bidder, ask, asker)
          ).to.be.revertedWith("Market: required royalties don't match");
        });
        it("errors if required royalties disagree on an amount", async () => {
          const { market, asker, bidder, tokenIdBid, newAsk, newAgreement } =
            await setup();
          const bid = tokenIdBid({
            requiredRoyalties: [{ recipient: bidder.address, micros: 10 }],
          });
          const ask = newAsk({
            requiredRoyalties: [{ recipient: bidder.address, micros: 11 }],
          });
          await expect(
            fillOrder(market, newAgreement(), bid, bidder, ask, asker)
          ).to.be.revertedWith("Market: required royalties don't match");
        });
      });

      it("the hardcoded royalty is paid correctly", async () => {
        const { market, asker, bidder, tokenIdBid, newAsk, signers, weth } =
          await setup();
        await market.setArchipelagoRoyaltyRate(5);
        const roy = micro.mul(5);
        const r0 = signers[3].address;
        await market.setTreasuryAddress(r0);
        const bid = tokenIdBid();
        const ask = newAsk();
        const tradeId = computeTradeId(bid, bidder, ask, asker);
        await expect(fillOrder(market, newAgreement(), bid, bidder, ask, asker))
          .to.emit(market, "RoyaltyPaid")
          .withArgs(tradeId, asker.address, r0, 5, roy);
        expect(await weth.balanceOf(r0)).to.equal(roy);
        expect(await weth.balanceOf(asker.address)).to.equal(exa.sub(roy));
      });

      it("only owner may change royalty recipient and rate", async () => {
        const { market, asker, bidder, tokenIdBid, newAsk, signers } =
          await setup();
        let fail = market.connect(bidder).setArchipelagoRoyaltyRate(3);
        expect(fail).to.be.revertedWith("Ownable: caller is not the owner");
        fail = market.connect(bidder).setTreasuryAddress(bidder.address);
        expect(fail).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });

    describe("failure cases", () => {
      // nb: failrues due to cancellation are handled in a separate describe block.
      it("rejects expired bids", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
        } = await setup();
        const bid = tokenIdBid({ deadline: 0 });
        const ask = newAsk();
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects expired asks", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
        } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk({ deadline: 0 });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects if bid and ask disagree about price", async () => {
        const {
          market,
          signers,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ price: exa.div(2) });
        const ask = newAsk({ price: exa });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("price mismatch");
      });

      it("rejects if bid and ask disagree about tokenId", async () => {
        const {
          market,
          signers,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ tokenId: 0 });
        const ask = newAsk({ tokenId: 1 });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("tokenid mismatch");
      });

      it("rejects if bid and ask disagree about token address", async () => {
        const {
          market,
          signers,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ tokenAddress: market.address });
        const ask = newAsk();
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("token address mismatch");
      });

      it("rejects if bid and ask disagree about currency address", async () => {
        const {
          market,
          signers,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const bid = tokenIdBid({ currencyAddress: market.address });
        const ask = newAsk();
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("currency address mismatch");
      });

      it("rejects if ERC-20 transfer returns `false`", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        await weth.setPaused(true);
        const bid = tokenIdBid();
        const ask = newAsk();
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("Market: transfer failed");
      });

      it("rejects if ERC-20 transfer returns `false` (in unwrap mode)", async () => {
        const {
          market,
          signers,
          weth,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        await weth.setPaused(true);
        const bid = tokenIdBid();
        const ask = newAsk({ unwrapWeth: true });
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, asker)
        ).to.be.revertedWith("Market: transfer failed");
      });
    });

    describe("approvals", () => {
      it("rejects if asker lacks approvals", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          tokenIdBid,
          newAsk,
          newAgreement,
        } = await setup();
        const operator = signers[3];
        const bid = tokenIdBid();
        const ask = newAsk();
        await expect(
          fillOrder(market, newAgreement(), bid, bidder, ask, operator)
        ).to.be.revertedWith("asker is not owner or approved");
      });
      it("works if asker is owner", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          asker,
          tokenIdBid,
          newAsk,
        } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // Owner got proceeds
      });
      it("works if asker is approved for all", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          asker,
          tokenIdBid,
          newAsk,
        } = await setup();
        const operator = signers[3];
        await nft.connect(asker).setApprovalForAll(operator.address, true);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, operator);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
      });
      it("works if asker has token approval", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          bidder,
          asker,
          tokenIdBid,
          newAsk,
        } = await setup();
        const operator = signers[3];
        await nft.connect(asker).approve(operator.address, 0);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, operator);
      });
      it("fails if asker has not approved the market (for NFT)", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
        } = await setup();
        nft.connect(asker).setApprovalForAll(market.address, false);
        const bid = tokenIdBid();
        const ask = newAsk();

        const fail = fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "ERC721: transfer caller is not owner nor approved"
        );
      });
      it("fails if bidder has not approved the market (for WETH)", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
        } = await setup();
        weth.connect(bidder).approve(market.address, 0);
        const bid = tokenIdBid();
        const ask = newAsk();

        const fail = fillOrder(market, newAgreement(), bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "ERC20: transfer amount exceeds allowance"
        );
      });
      it("succeeds if asker has approved the token specifically", async () => {
        const {
          market,
          signers,
          weth,
          nft,
          asker,
          bidder,
          tokenIdBid,
          newAsk,
        } = await setup();
        nft.connect(asker).setApprovalForAll(market.address, false);
        nft.connect(asker).approve(market.address, 0);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
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
          tokenIdBid,
          newAsk,
        } = await setup();
        const operator = signers[3];
        await nft.connect(owner).setApprovalForAll(operator.address, true);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, newAgreement(), bid, bidder, ask, operator);
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
          tokenIdBid,
          newAsk,
        } = await setup();
        const operator = signers[3];
        await nft.connect(owner).setApprovalForAll(operator.address, true);
        const bid = tokenIdBid();
        const ask = newAsk({ unwrapWeth: true });
        const balanceBefore = await operator.getBalance();
        const ownerBalanceBefore = await owner.getBalance();
        await fillOrder(market, newAgreement(), bid, bidder, ask, operator);
        const balanceAfter = await operator.getBalance();
        expect(balanceAfter.sub(balanceBefore)).to.equal(exa);
        expect(await owner.getBalance()).to.equal(ownerBalanceBefore);
      });
    });
  });
  describe("cancellation mechanics", () => {
    it("orders may fail due to bid nonce cancellation", async () => {
      const {
        market,
        signers,
        weth,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.connect(bidder).cancelNonces([bid.nonce]);
      expect(
        await market.nonceCancellation(bidder.address, bid.nonce)
      ).to.equal(true);
      await expect(
        fillOrder(market, newAgreement(), bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to ask nonce cancellation", async () => {
      const {
        market,
        signers,
        weth,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.connect(asker).cancelNonces([ask.nonce]);
      expect(await market.nonceCancellation(asker.address, ask.nonce)).to.equal(
        true
      );
      await expect(
        fillOrder(market, newAgreement(), bid, bidder, ask, asker)
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
      const {
        market,
        signers,
        weth,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      expect(
        await market.nonceCancellation(bidder.address, bid.nonce)
      ).to.equal(true);
      expect(await market.nonceCancellation(asker.address, ask.nonce)).to.equal(
        true
      );
    });
    it("events are emitted on nonce cancellations", async () => {
      const { market, signers } = await setup();
      const address = signers[0].address;
      const cancelNonces = market.cancelNonces([102, 103]);
      await expect(cancelNonces)
        .to.emit(market, "NonceCancellation")
        .withArgs(address, 102)
        .to.emit(market, "NonceCancellation")
        .withArgs(address, 103);
    });
  });
  describe("EIP-712 struct hash helpers", () => {
    it("properly hash bids", async () => {
      const { market, signers, bidder, traitBid } = await setup();
      const bid = traitBid({
        nonce: 1,
        deadline: sdk.market.MaxUint40,
        price: exa,
        trait: 0x1234,
        extraRoyalties: [
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
      const { market, signers, asker, newAsk, newAgreement } = await setup();
      const ask = newAsk({
        nonce: 1,
        deadline: sdk.market.MaxUint40,
        tokenId: 0x12345678,
        price: exa,
        extraRoyalties: [
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
  describe("emergency shutdown", () => {
    it("the owner may shut down the market", async () => {
      const {
        market,
        signers,
        weth,
        nft,
        asker,
        bidder,
        tokenIdBid,
        newAsk,
        newAgreement,
      } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.setEmergencyShutdown(true);
      const fail = fillOrder(market, newAgreement(), bid, bidder, ask, asker);
      expect(fail).to.be.revertedWith("Market is shut down");
    });
    it("non-owner may not shut down the market", async () => {
      const { market, bidder } = await setup();
      const fail = market.connect(bidder).setEmergencyShutdown(true);
      expect(fail).to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("the owner may restart the market", async () => {
      const { market, asker, bidder, tokenIdBid, newAsk, newAgreement } =
        await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.setEmergencyShutdown(true);
      await market.setEmergencyShutdown(false);
      await fillOrder(market, newAgreement(), bid, bidder, ask, asker);
    });
  });
});
