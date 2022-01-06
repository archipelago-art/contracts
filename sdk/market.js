const ethers = require("ethers");

const { SignatureKind, hashLegacyMessage } = require("./signatureChecker");

const MaxUint40 = ethers.BigNumber.from((1n << 40n) - 1n);

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
  { type: "bytes32", name: "agreementHash" },
  { type: "uint256", name: "nonce" },
  { type: "uint40", name: "deadline" },
  { type: "Royalty[]", name: "extraRoyalties" },
  { type: "bytes", name: "trait" },
  { type: "address", name: "traitOracle" },
];
const Ask = [
  { type: "bytes32", name: "agreementHash" },
  { type: "uint256", name: "nonce" },
  { type: "uint40", name: "deadline" },
  { type: "Royalty[]", name: "extraRoyalties" },
  { type: "uint256", name: "tokenId" },
  { type: "bool", name: "unwrapWeth" },
  { type: "address", name: "authorizedBidder" },
];
const OrderAgreement = [
  { type: "address", name: "currencyAddress" },
  { type: "uint256", name: "price" },
  { type: "address", name: "tokenAddress" },
  { type: "Royalty[]", name: "requiredRoyalt" },
];
const Royalty = [
  { type: "address", name: "recipient" },
  { type: "uint256", name: "micros" },
];

const hash = Object.freeze({
  bid: bidStructHash,
  ask: askStructHash,
  orderAgreement: orderAgreementStructHash,
});

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
const TYPENAME_ORDER_AGREEMENT =
  "OrderAgreement(address currencyAddress,uint256 price,address tokenAddress,Royalty[] requiredRoyalties)";
const TYPENAME_BID =
  "Bid(uint256 nonce,uint40 deadline,address currencyAddress,uint256 price,address tokenAddress,Royalty[] requiredRoyalties,Royalty[] extraRoyalties,bytes trait,address traitOracle)";
const TYPENAME_ASK =
  "Ask(uint256 nonce,uint40 deadline,address currencyAddress,uint256 price,address tokenAddress,Royalty[] requiredRoyalties,Royalty[] extraRoyalties,uint256 tokenId,bool unwrapWeth,address authorizedBidder)";

const TYPEHASH_ROYALTY = utf8Hash(TYPENAME_ROYALTY);
const TYPEHASH_ORDER_AGREEMENT = utf8Hash(
  TYPENAME_ORDER_AGREEMENT + TYPENAME_ROYALTY
);
const TYPEHASH_BID = utf8Hash(
  TYPENAME_BID + TYPENAME_ORDER_AGREEMENT + TYPENAME_ROYALTY
);
const TYPEHASH_ASK = utf8Hash(
  TYPENAME_ASK + TYPENAME_ORDER_AGREEMENT + TYPENAME_ROYALTY
);

function royaltyStructHash(royalty) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "uint256"],
      [TYPEHASH_ROYALTY, royalty.recipient, royalty.micros]
    )
  );
}

function royaltyArrayStructHash(royalties) {
  const elementHashes = royalties.map(royaltyStructHash);
  return ethers.utils.keccak256(
    ethers.utils.solidityPack(["bytes32[]"], [elementHashes])
  );
}

function orderAgreementStructHash(orderAgreement) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "uint256", "address", "bytes32"],
      [
        TYPEHASH_ORDER_AGREEMENT,
        orderAgreement.currencyAddress,
        orderAgreement.price,
        orderAgreement.tokenAddress,
        royaltyArrayStructHash(orderAgreement.requiredRoyalties),
      ]
    )
  );
}

function bidStructHash(bid) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "bytes32",
        "bytes32",
        "uint256",
        "uint40",
        "bytes32",
        "bytes32",
        "address",
      ],
      [
        TYPEHASH_BID,
        bid.agreementHash,
        bid.nonce,
        bid.deadline,
        royaltyArrayStructHash(bid.extraRoyalties),
        ethers.utils.keccak256(bid.trait),
        bid.traitOracle,
      ]
    )
  );
}

function askStructHash(ask) {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "bytes32",
        "bytes32",
        "uint256",
        "uint40",
        "bytes32",
        "uint256",
        "bool",
        "address",
      ],
      [
        TYPEHASH_ASK,
        ask.agreementHash,
        ask.nonce,
        ask.deadline,
        ask.currencyAddress,
        ask.price,
        ask.tokenAddress,
        royaltyArrayStructHash(ask.extraRoyalties),
        ask.tokenId,
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

const verifyLegacy = Object.freeze({
  bid(signature, domainInfo, msg) {
    return verifyLegacyMessage(signature, domainInfo, bidStructHash(msg));
  },
  ask(signature, domainInfo, msg) {
    return verifyLegacyMessage(signature, domainInfo, askStructHash(msg));
  },
});

const signLegacy = Object.freeze({
  bid(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, bidStructHash(msg));
  },
  ask(signer, domainInfo, msg) {
    return signLegacyMessage(signer, domainInfo, askStructHash(msg));
  },
});

const sign = Object.freeze({
  bid(signatureKind, signer, domainInfo, msg) {
    switch (signatureKind) {
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        return signLegacy.bid(signer, domainInfo, msg);
      case SignatureKind.EIP_712:
        return sign712.bid(signer, domainInfo, msg);
      default:
        throw new Error(`unsupported signature kind: ${signatureKind}`);
    }
  },
  ask(signatureKind, signer, domainInfo, msg) {
    switch (signatureKind) {
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        return signLegacy.ask(signer, domainInfo, msg);
      case SignatureKind.EIP_712:
        return sign712.ask(signer, domainInfo, msg);
      default:
        throw new Error(`unsupported signature kind: ${signatureKind}`);
    }
  },
});

const verify = Object.freeze({
  bid(signatureKind, signature, domainInfo, msg) {
    switch (signatureKind) {
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        return verifyLegacy.bid(signature, domainInfo, msg);
      case SignatureKind.EIP_712:
        return verify712.bid(signature, domainInfo, msg);
      default:
        throw new Error(`unsupported signature kind: ${signatureKind}`);
    }
  },
  ask(signatureKind, signature, domainInfo, msg) {
    switch (signatureKind) {
      case SignatureKind.ETHEREUM_SIGNED_MESSAGE:
        return verifyLegacy.ask(signature, domainInfo, msg);
      case SignatureKind.EIP_712:
        return verify712.ask(signature, domainInfo, msg);
      default:
        throw new Error(`unsupported signature kind: ${signatureKind}`);
    }
  },
});

const abi = Object.freeze({
  Ask: require("./_abi/ask"),
  Bid: require("./_abi/bid"),
});

module.exports = {
  MaxUint40,
  domainSeparator,
  abi,
  sign,
  verify,
  hash,
  sign712,
  verify712,
  signLegacy,
  verifyLegacy,
};
