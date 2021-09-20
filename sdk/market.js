const BidType = Object.freeze({
  SINGLE_TOKEN: 0,
  TRAITSET: 1,
});

function domainSeparator({ marketAddress, chainId }) {
  return {
    name: "ArchipelagoMarket",
    chainId,
    verifyingContract: marketAddress,
  };
}

const Bid = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "uint256", name: "price" },
  { type: "uint8", name: "bidType" },
  { type: "uint256", name: "tokenId" },
  { type: "uint256[]", name: "traitset" },
  { type: "Royalty[]", name: "royalties" },
];
const Ask = [
  { type: "uint256", name: "nonce" },
  { type: "uint256", name: "created" },
  { type: "uint256", name: "deadline" },
  { type: "uint256", name: "price" },
  { type: "uint256", name: "tokenId" },
  { type: "Royalty[]", name: "royalties" },
  { type: "bool", name: "unwrapWeth" },
];
const Royalty = [
  { type: "address", name: "recipient" },
  { type: "uint256", name: "bps" },
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

module.exports = {
  BidType,
  domainSeparator,
  sign712,
};
