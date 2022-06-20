# Archipelago

**Mainnet market contract: `0x555598409fe9a72f0a5e423245c34555f6445555`**

Archipelago is a marketplace for exchanging NFTs (ERC-721s) in exchange for
ERC-20s, typically WETH.

Archipelago has an off-chain orderbook with on-chain execution. Asks always
specify a particular ERC-721 to be sold at a fixed price. Bids may either bid
for a specific token, or may be a "trait bid" that uses an external trait oracle
to determine which tokens match the bid.

In order to match, bids and asks must agree on an "Order Agreement", including
the ERC20 currency being used for payment, the ERC721 NFT contract being traded,
the price, and the required royalties. Bids and asks also have deadlines (for
expiring orders) and nonces (which allows linked orders and order cancellation).

For every user, each nonce may only be executed once, which allows the
construction of "linked" orders. For example, if someone makes two orders both
offering to buy Fidenzas, and they have the same nonce, then they will buy at
most one Fidenza, because the second order will become invalid after the first
executes.

Asks may additionally specify an authorizedBidder, in which case only the
specified bidder address is allowed to fill the ask.

Royalties are paid on-chain as part of filling a NFT sale. There is a hardcoded
"protocol royalty" which is paid to the Archipelago treasury address, and is
capped at 50 basis points. The bid and ask must agree on "required royalties",
which typically includes a royalty to the NFT artist. The required royalties are
paid from the seller's proceeds. The buyer and seller may both specify
additional royalties (e.g. to a broker, or to a frontend that they used). Extra
seller royalties are paid by the seller (i.e. deducted from sale price), while
extra buyer royalties are paid by the buyer (i.e. in addition to the stated sale
price).

Royalties may be hardcoded to a specific address, or may point to an on-chain
royalty oracle. If a royalty oracle is used, the royalty recipients are
determined at transaction time, but the total royalty amount is capped
separately from the oracle. If the oracle attempts to send more royalties than
specified in the order, the transaction will revert.

While we support using arbitrary ERC-20s as currencies, we expect that ETH/WETH
will be the primary currency for trading NFTs. Thus, we've built a few
convenience helpers for automatically wrapping or unwrapping WETH. If a seller
would like to receive proceeds in ETH rather than WETH, they may set
`unwrapWeth` in their ask, and the weth will be unwrapped during the sale and
sent to the seller. If a buyer wants to pay in ETH rather than WETH, and they
are filling an order (not making a bid), they can call `fillOrderEth` to pay in
ETH, which is auto-unwrapped.

For benefit of code reviewers, here are the key files in the project:

- [contracts/ArchipelagoMarket.sol](./contracts/ArchipelagoMarket.sol): The core
  market contract
- [test/ArchipelagoMarket.test.js](./test/ArchipelagoMarket.test.js): Unit tests
  for the market
- [contracts/MarketMessages.sol](./contracts/MarketMessages.sol): Data types,
  including bids and asks
- [sdk/market.js](./sdk/market.js): The sdk for interacting with Archipelago
  contracts
- [contracts/ITraitOracle.sol](./contracts/ITraitOracle.sol): The interface for
  Trait Oracles, which resolve trait bids
- [contracts/ArtblocksOracle.sol](./contracts/ArtblocksOracle.sol): The
  ArtBlocks trait oracle
- [contracts/IRoyaltyOracle.sol](./contracts/IRoyaltyOracle.sol): The interface
  for Royalty Oracles

## Development

### Install Dependencies

`npm install`

### Test

`npm t`

### Prettify code

`npm run fix`

### Diff gas across a change

```shell
$ git checkout before-my-change
$ npx hardhat compile && node scripts/gas.js -j >/tmp/before
$ git checkout my-change
$ npx hardhat compile && node scripts/gas.js -j >/tmp/after
$ ./scripts/diff-gas /tmp/before /tmp/after
```
