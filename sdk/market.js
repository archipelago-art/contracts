const ethers = require("ethers");

const { hashLegacyMessage } = require("./signatureChecker");

const BidType = Object.freeze({
  TOKEN_ID: 0,
  TRAITSET: 1,
});

function utf8Hash(s) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
}

function domainSeparator({ chainId, marketAddress }) {
  return {
    name: "ArchipelagoMarket",
    chainId,
    verifyingContract: marketAddress,
  };
}

function rawDomainSeparator(domainInfo) {
  const type =
    "EIP712Domain(string name,uint256 chainId,address verifyingContract)";
  const { name, chainId, verifyingContract } = domainSeparator(domainInfo);
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "uint256", "address"],
      [utf8Hash(type), utf8Hash(name), chainId, verifyingContract]
    )
  );
}

const Bid = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "address", name: "currencyAddress" },
  { type: "uint256", name: "price" },
  { type: "address", name: "tokenAddress" },
  { type: "uint8", name: "bidType" },
  { type: "uint256", name: "tokenId" },
  { type: "uint256[]", name: "traitset" },
  { type: "address", name: "traitOracle" },
  { type: "Royalty[]", name: "royalties" },
];
const Ask = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "address", name: "currencyAddress" },
  { type: "uint256", name: "price" },
  { type: "address", name: "tokenAddress" },
  { type: "uint256", name: "tokenId" },
  { type: "Royalty[]", name: "royalties" },
  { type: "bool", name: "unwrapWeth" },
  { type: "address", name: "authorizedBidder" },
];
const Royalty = [
  { type: "address", name: "recipient" },
  { type: "uint256", name: "micros" },
];

const sign712 = Object.freeze({
  bid(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { Bid, Royalty },
      msg
    );
  },
  ask(signer, domainInfo, msg) {
    return signer._signTypedData(
      domainSeparator(domainInfo),
      { Ask, Royalty },
      msg
    );
  },
});

const verify712 = Object.freeze({
  bid(signature, domainInfo, msg) {
    return ethers.utils.verifyTypedData(
      domainSeparator(domainInfo),
      { Bid, Royalty },
      msg,
      signature
    );
  },
  ask(signature, domainInfo, msg) {
    return ethers.utils.verifyTypedData(
      domainSeparator(domainInfo),
      { Ask, Royalty },
      msg,
      signature
    );
  },
});

const TYPENAME_ROYALTY = "Royalty(address recipient,uint256 micros)";
const TYPENAME_BID =
  "Bid(uint256 nonce,uint256 created,uint256 deadline,address currencyAddress,uint256 price,address tokenAddress,uint8 bidType,uint256 tokenId,uint256[] traitset,address traitOracle,Royalty[] royalties)";
const TYPENAME_ASK =
  "Ask(uint256 nonce,uint256 created,uint256 deadline,address currencyAddress,uint256 price,address tokenAddress,uint256 tokenId,Royalty[] royalties,bool unwrapWeth,address authorizedBidder)";

const TYPEHASH_ROYALTY = utf8Hash(TYPENAME_ROYALTY);
const TYPEHASH_BID = utf8Hash(TYPENAME_BID + TYPENAME_ROYALTY);
const TYPEHASH_ASK = utf8Hash(TYPENAME_ASK + TYPENAME_ROYALTY);

function royaltyStructHash(royalty) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "uint256"],
      [TYPEHASH_ROYALTY, royalty.recipient, royalty.micros]
    )
  );
}

function bidStructHash(bid) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "uint256",
        "address",
        "uint8",
        "uint256",
        "bytes32",
        "address",
        "bytes32",
      ],
      [
        TYPEHASH_BID,
        bid.nonce,
        bid.created,
        bid.deadline,
        bid.currencyAddress,
        bid.price,
        bid.tokenAddress,
        bid.bidType,
        bid.tokenId,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(["uint256[]"], [bid.traitset])
        ),
        bid.traitOracle,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["bytes32[]"],
            [bid.royalties.map(royaltyStructHash)]
          )
        ),
      ]
    )
  );
}

function askStructHash(ask) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "uint256",
        "address",
        "uint256",
        "bytes32",
        "bool",
        "address",
      ],
      [
        TYPEHASH_ASK,
        ask.nonce,
        ask.created,
        ask.deadline,
        ask.currencyAddress,
        ask.price,
        ask.tokenAddress,
        ask.tokenId,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["bytes32[]"],
            [ask.royalties.map(royaltyStructHash)]
          )
        ),
        ask.unwrapWeth,
        ask.authorizedBidder,
      ]
    )
  );
}

async function signLegacyMessage(signer, domainInfo, structHash) {
  const blob = hashLegacyMessage(rawDomainSeparator(domainInfo), structHash);
  return await signer.signMessage(blob);
}

function verifyLegacyMessage(signature, domainInfo, structHash) {
  const blob = hashLegacyMessage(rawDomainSeparator(domainInfo), structHash);
  return ethers.utils.verifyMessage(blob, signature);
}

const signLegacy = Object.freeze({
  bid(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, bidStructHash(msg));
  },
  ask(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, askStructHash(msg));
  },
});

const verifyLegacy = Object.freeze({
  bid(signature, domainInfo, msg) {
    return verifyLegacyMessage(signature, domainInfo, bidStructHash(msg));
  },
  ask(signature, domainInfo, msg) {
    return verifyLegacyMessage(signature, domainInfo, askStructHash(msg));
  },
});

function royaltyAmount(micros, price) {
  return micros.mul(price).div(1e6);
}

function computeSale({ bid, ask }) {
  const bidPrice = ethers.BigNumber.from(bid.price);
  const askPrice = ethers.BigNumber.from(ask.price);
  if (!bidPrice.eq(askPrice)) {
    throw new Error(`price mismatch: bid = ${bidPrice}, ask = ${askPrice}`);
  }
  const price = bidPrice;
  let proceeds = price;
  let cost = price;
  const buyerRoyalties = [];
  const sellerRoyalties = [];

  for (const r of ask.royalties) {
    const micros = ethers.BigNumber.from(r.micros);
    const recipient = ethers.utils.getAddress(r.recipient);
    const amount = royaltyAmount(micros, price);
    proceeds = proceeds.sub(amount);
    sellerRoyalties.push({ recipient, micros, amount });
  }
  if (proceeds.lt(ethers.constants.Zero)) {
    throw new Error("seller royalties exceed 100% of sale price");
  }

  for (const r of bid.royalties) {
    const micros = ethers.BigNumber.from(r.micros);
    const recipient = ethers.utils.getAddress(r.recipient);
    const amount = royaltyAmount(micros, price);
    cost = cost.add(amount);
    buyerRoyalties.push({ recipient, micros, amount });
  }

  return {
    cost,
    proceeds,
    buyerRoyalties,
    sellerRoyalties,
  };
}

module.exports = {
  BidType,
  domainSeparator,
  sign712,
  verify712,
  signLegacy,
  verifyLegacy,
  computeSale,
};
