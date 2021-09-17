const { expect } = require("chai");
const { ethers } = require("hardhat");

const BN = ethers.BigNumber;

const BidType = Object.freeze({
  SINGLE_TOKEN: 0,
  TRAITSET: 1,
});

describe("Market", () => {
  const exa = BN.from("10").pow(18);
  let Market;
  let TestERC20;
  let TestERC721;
  before(async () => {
    [Market, TestERC20, TestERC721, TestTraitOracle] = await Promise.all([
      ethers.getContractFactory("Market"),
      ethers.getContractFactory("TestERC20"),
      ethers.getContractFactory("TestERC721"),
      ethers.getContractFactory("TestTraitOracle"),
    ]);
  });

  async function setup() {
    const signers = await ethers.getSigners();
    const [market, weth, nft, oracle] = await Promise.all([
      Market.deploy(),
      TestERC20.deploy(),
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
    await weth.mint(bidder.address, exa); // give bidder 1 full weth
    await weth
      .connect(bidder)
      .approve(market.address, ethers.constants.MaxUint256);
    // give asker token ids 0 and 1
    await nft.mint(asker.address, 0);
    await nft.mint(asker.address, 1);
    await nft.connect(asker).setApprovalForAll(market.address, true);
    return { signers, market, weth, nft, bidder, asker, oracle };
  }

  it("deploys", async () => {
    const { market } = await setup();
  });

  function tokenIdBid({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    tokenId = 0,
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenId,
      traitset: [],
      bidType: BidType.SINGLE_TOKEN,
    };
  }

  function traitsetBid({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    traitset = [],
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenId: 0,
      traitset,
      bidType: BidType.TRAITSET,
    };
  }

  function newAsk({
    nonce = 0,
    created = 1,
    deadline = ethers.constants.MaxUint256,
    price = exa,
    tokenId = 0,
  } = {}) {
    return {
      nonce,
      created,
      deadline,
      price,
      tokenId,
    };
  }

  async function signBlob(blob, signer) {
    const hash = ethers.utils.arrayify(ethers.utils.keccak256(blob));
    const result = await signer.signMessage(hash);
    return result;
  }

  async function signBid(bid, signer) {
    const blob = ethers.utils.defaultAbiCoder.encode(
      ["(uint256,uint256,uint256,uint256,uint8,uint256,uint256[])"],
      [
        [
          bid.nonce,
          bid.created,
          bid.deadline,
          bid.price,
          bid.bidType,
          bid.tokenId,
          bid.traitset,
        ],
      ]
    );
    return signBlob(blob, signer);
  }

  async function signAsk(ask, signer) {
    const blob = ethers.utils.defaultAbiCoder.encode(
      ["(uint256,uint256,uint256,uint256,uint256)"],
      [[ask.nonce, ask.created, ask.deadline, ask.price, ask.tokenId]]
    );
    return signBlob(blob, signer);
  }

  async function fillOrder(market, bid, bidder, ask, asker) {
    const bidSignature = await signBid(bid, bidder);
    const askSignature = await signAsk(ask, asker);
    return market.fillOrder(bid, bidSignature, ask, askSignature);
  }

  describe("order filling", () => {
    it("works in a basic tokenId specified case", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      expect(await nft.ownerOf(0)).to.equal(asker.address);
      const bid = tokenIdBid();
      const ask = newAsk();

      await fillOrder(market, bid, bidder, ask, asker);
      expect(await nft.ownerOf(0)).to.equal(bidder.address);
      expect(await weth.balanceOf(bidder.address)).to.equal(0);
      expect(await weth.balanceOf(asker.address)).to.equal(exa); // TODO: fix when we add royalties
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
    });

    describe("failure cases", () => {
      // nb: failrues due to cancellation are handled in a separate describe block.
      it("rejects expired bids", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdBid({ deadline: 0 });
        const ask = newAsk();
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects expired asks", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk({ deadline: 0 });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("cancelled or expired");
      });

      it("rejects if bid and ask disagree about price", async () => {
        const { market, signers, asker, bidder } = await setup();
        const bid = tokenIdBid({ price: exa.div(2) });
        const ask = newAsk({ price: exa });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("price mismatch");
      });

      it("rejects if bid and ask disagree about tokenId", async () => {
        const { market, signers, asker, bidder } = await setup();
        const bid = tokenIdBid({ tokenId: 0 });
        const ask = newAsk({ tokenId: 1 });
        await expect(
          fillOrder(market, bid, bidder, ask, asker)
        ).to.be.revertedWith("tokenid mismatch");
      });
    });

    describe("approvals", () => {
      it("rejects if asker lacks approvals", async () => {
        const { market, signers, weth, nft, bidder } = await setup();
        const operator = signers[3];
        const bid = tokenIdBid();
        const ask = newAsk();
        await expect(
          fillOrder(market, bid, bidder, ask, operator)
        ).to.be.revertedWith("asker is not owner or approved");
      });
      it("works if asker is owner", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // Owner got proceeds
      });
      it("works if asker is approved for all", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const operator = signers[3];
        await nft.connect(asker).setApprovalForAll(operator.address, true);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, operator);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // Owner got proceeds (not operator)
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
      });
      it("works if asker has token approval", async () => {
        const { market, signers, weth, nft, bidder, asker } = await setup();
        const operator = signers[3];
        await nft.connect(asker).approve(operator.address, 0);
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, operator);
        expect(await weth.balanceOf(asker.address)).to.equal(exa); // Owner got proceeds (not operator)
      });
      it("fails if asker has not approved the market (for NFT)", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        nft.connect(asker).setApprovalForAll(market.address, false);
        const bid = tokenIdBid();
        const ask = newAsk();

        const fail = fillOrder(market, bid, bidder, ask, asker);
        await expect(fail).to.be.revertedWith(
          "ERC721: transfer caller is not owner nor approved"
        );
      });
      it("fails if bidder has not approved the market (for WETH)", async () => {
        const { market, signers, weth, nft, asker, bidder } = await setup();
        weth.connect(bidder).approve(market.address, 0);
        const bid = tokenIdBid();
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
        const bid = tokenIdBid();
        const ask = newAsk();
        await fillOrder(market, bid, bidder, ask, asker);
        expect(await nft.ownerOf(0)).to.equal(bidder.address);
      });
    });
  });
  describe("cancellation mechanics", () => {
    it("orders may fail due to bid timestamp cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.connect(bidder).cancelBids(bid.created);
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to ask timestamp cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdBid();
      const ask = newAsk();
      await market.connect(asker).cancelAsks(ask.created);
      await expect(
        fillOrder(market, bid, bidder, ask, asker)
      ).to.be.revertedWith("cancelled");
    });
    it("orders may fail due to bid nonce cancellation", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      const bid = tokenIdBid();
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
      const bid = tokenIdBid();
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
      const bid = tokenIdBid();
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
  });
});
