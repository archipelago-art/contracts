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
    [Market, TestERC20, TestERC721] = await Promise.all([
      ethers.getContractFactory("Market"),
      ethers.getContractFactory("TestERC20"),
      ethers.getContractFactory("TestERC721"),
    ]);
  });

  async function setup() {
    const signers = await ethers.getSigners();
    const [market, weth, nft] = await Promise.all([
      Market.deploy(),
      TestERC20.deploy(),
      TestERC721.deploy(),
    ]);
    await Promise.all([market.deployed(), weth.deployed(), nft.deployed()]);
    await market.initialize(nft.address, weth.address);
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
    return { signers, market, weth, nft, bidder, asker };
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
      [
        {
          components: [
            {
              internalType: "uint256",
              name: "nonce",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "created",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "deadline",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "price",
              type: "uint256",
            },
            {
              internalType: "enum BidType",
              name: "bidType",
              type: "uint8",
            },
            {
              internalType: "uint256",
              name: "tokenId",
              type: "uint256",
            },
            {
              internalType: "uint256[]",
              name: "traitset",
              type: "uint256[]",
            },
          ],
          internalType: "struct Bid",
          name: "bid",
          type: "tuple",
        },
      ],
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
      [
        {
          components: [
            {
              internalType: "uint256",
              name: "nonce",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "created",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "deadline",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "price",
              type: "uint256",
            },
            {
              internalType: "uint256",
              name: "tokenId",
              type: "uint256",
            },
          ],
          internalType: "struct Ask",
          name: "ask",
          type: "tuple",
        },
      ],
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
    it("works in a basic case", async () => {
      const { market, signers, weth, nft, asker, bidder } = await setup();
      expect(await nft.ownerOf(0)).to.equal(asker.address);
      const bid = tokenIdBid();
      const ask = newAsk();

      await fillOrder(market, bid, bidder, ask, asker);
      expect(await nft.ownerOf(0)).to.equal(bidder.address);
      expect(await weth.balanceOf(bidder.address)).to.equal(0);
      expect(await weth.balanceOf(asker.address)).to.equal(exa); // TODO: fix when we add royalties
    });

    describe.skip("token approvals", () => {
      it("rejects if asker lacks approvals", async () => {
        const { market, signers, weth, nft, bidder } = await setup();
        const bid = tokenIdBid();
        const ask = newAsk();
        // tbc
      });
      it("works if asker is owner", async () => {
        //
      });
      it("works if asker is approved for all", async () => {
        //
      });
      it("works if asker has token approval", async () => {
        //
      });
    });
  });
});
