# Archipelago Protocol

Archipelago is a protocol for creating permissionless marketplaces for buying
and selling NFTs that are priced in ETH.

The key features of Archipelago markets are:

- Allows exchanging NFTs for ETH or WETH
- Off-chain bids and asks, with on-chain execution
- Collection-wide floor bids
- Trait-wide floor bids (via a flexible oracle for Trait membership)
- Optional nonce order linking, to create linked sets of `n` orders, where all
  are initially valid but only at most `k` may execute.
- On-chain, nonce-based order cancellation, to cancel groups of orders
  simultaneously
- "Panic button" timestamp order cancellation, enabling killing all open bids or
  asks immediately.
- Allows user-specified royalties, including both asker royalties (seller pays)
  and bidder royalties (buyer pays)

Archipelago is organized around [Markets](./contracts/Market.sol). Each Market
allows the trading the tokens of a particular ERC-721 contract, and is
non-upgradable. At initialization time, each Market may be provided with a
[Trait Oracle](./contracts/ITraitOracle.sol), which allows testing whether a
particular tokenId possesses certain traits. We've also implemented a
well-optimized [Art Blocks Trait Oracle](./contracts/ArtblocksTraitOracle.sol)
for the specific case of Art Blocks projects.

## Development

### Install Dependencies

`npm install`

### Test

`npm t`

### Prettify code

`npm run fix`
