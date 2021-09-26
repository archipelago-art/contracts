const ethers = require("ethers");

const BidType = Object.freeze({
  TOKEN_IDS: 0,
  TRAITSET: 1,
});

function utf8Hash(s) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
}

function domainSeparator({
  chainId,
  tokenAddress,
  wethAddress,
  traitOracleAddress,
}) {
  return {
    name: "ArchipelagoMarket",
    chainId,
    salt: domainSeparatorSalt({
      tokenAddress,
      wethAddress,
      traitOracleAddress,
    }),
  };
}

function domainSeparatorSalt({
  tokenAddress,
  wethAddress,
  traitOracleAddress,
}) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "address", "address"],
      [tokenAddress, wethAddress, traitOracleAddress]
    )
  );
}

function rawDomainSeparator(domainInfo) {
  const type = "EIP712Domain(string name,uint256 chainId,bytes32 salt)";
  const { name, chainId, salt } = domainSeparator(domainInfo);
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "uint256", "bytes32"],
      [utf8Hash(type), utf8Hash(name), chainId, salt]
    )
  );
}

const Bid = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "uint256", name: "price" },
  { type: "uint8", name: "bidType" },
  { type: "uint256[]", name: "tokenIds" },
  { type: "uint256[]", name: "traitset" },
  { type: "Royalty[]", name: "royalties" },
];
const Ask = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "uint256", name: "price" },
  { type: "uint256[]", name: "tokenIds" },
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

const TYPENAME_ROYALTY = "Royalty(address recipient,uint256 micros)";
const TYPENAME_BID =
  "Bid(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint8 bidType,uint256[] tokenIds,uint256[] traitset,Royalty[] royalties)";
const TYPENAME_ASK =
  "Ask(uint256 nonce,uint256 created,uint256 deadline,uint256 price,uint256[] tokenIds,Royalty[] royalties,bool unwrapWeth,address authorizedBidder)";

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
        "uint256",
        "uint8",
        "bytes32",
        "bytes32",
        "bytes32",
      ],
      [
        TYPEHASH_BID,
        bid.nonce,
        bid.created,
        bid.deadline,
        bid.price,
        bid.bidType,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(["uint256[]"], [bid.tokenIds])
        ),
        ethers.utils.keccak256(
          ethers.utils.solidityPack(["uint256[]"], [bid.traitset])
        ),
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
        "uint256",
        "bytes32",
        "bytes32",
        "bool",
        "address",
      ],
      [
        TYPEHASH_ASK,
        ask.nonce,
        ask.created,
        ask.deadline,
        ask.price,
        ethers.utils.keccak256(
          ethers.utils.solidityPack(["uint256[]"], [ask.tokenIds])
        ),
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
  const blob = ethers.utils.arrayify(
    ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32"],
        [rawDomainSeparator(domainInfo), structHash]
      )
    )
  );
  return await signer.signMessage(blob);
}

const signLegacy = Object.freeze({
  bid(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, bidStructHash(msg));
  },
  ask(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, askStructHash(msg));
  },
});

module.exports = {
  BidType,
  domainSeparator,
  sign712,
  signLegacy,
};
