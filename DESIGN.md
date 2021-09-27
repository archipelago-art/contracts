# Archipelago design

This document describes the design of the Archipelago system with a focus on
security and auditing. The intent is to clarify the intent of the system,
potential vulnerabilities, and mitigations that we've taken to address those.
This document is written for developers who are interested in understanding the
internals of Archipelago. End users do not need to read this document.

## Overview

The Archipelago contract system has three main pieces:

- the `Market` contract, an instance of which facilitates trading a class of
  ERC-721 tokens for a specific ERC-20 currency (typically WETH);
- the `ITraitOracle` interface, implementors of which define semantics for
  _traits_ that ERC-721 tokens may have, and respond to queries about which
  tokens have which traits; and
- the `ArtblocksTraitOracle` contract, which implements `ITraitOracle` with the
  semantics of the Art Blocks platform.

Users authorize orders with a market by signing messages off-chain (for
externally owned accounts) or writing explicit message approvals into the
market's contract storage (for contracts like Gnosis Safes). Given signatures
for a bid and ask that are compatible, any user may call `fillOrder` to execute
the trade.

An ask (sell order) specifies one or more tokens to be sold atomically. There
are two kinds of bids (buy orders). A bid may specify one or more tokens to be
bought atomically, just like an ask. Or, a bid may specify a list of traits, in
which case it represents an offer to purchase any single token matching _all_
listed traits. A "traitset bid" may only match an ask to sell a single token.

Bids and asks (collectively, orders) have some common metadata properties. An
order has a deadline, a Unix timestamp: if the EVM `TIMESTAMP` is greater than
the deadline, then the order is no longer valid. An order also has a creation
time, a Unix timestamp: an account can call a method on the `Market` contract to
cancel all bids (resp. asks) created before a certain time, as a kind of "panic
button". An order also has a nonce, an arbitrary `uint256`: each account may
only fill one order with a given nonce. As with creation times, an account can
call a method on the `Market` contract to cancel all orders with a given nonce.
All cancellations are recorded on chain in the market contract storage.

We anticipate that these nonce semantics will enable a few emergent order
patterns:

- All-at-once cancellation of relaxed orders. If you (say) list a NFT for sale
  at 10 ETH, then list it again for 9 ETH at the same nonce, then again for 8
  ETH, then decide that actually you don't want to sell it, then you can cancel
  all these orders by cancelling their common nonce. (On OpenSea, you need to
  cancel each order individually.)

- Linked 1-of-_n_ orders. If you have two Fidenzas and would like to take _some_
  liquidity but retain exposure to the project, you can place asks for both of
  them with the same nonce, and be confident that only one will be filled.
  Likewise, you can do the same for bids.

- Linked _k_-of-_n_ orders, an extension of the above. If you have 5 NFTs and
  want to sell at most 3 of them, you can choose three nonces and publish a
  total of 15 asks, one for each NFT/nonce combination. Then, each nonce can be
  filled by at most one NFT sale, so you'll sell at most three of the tokens. If
  you want to cancel the whole operation, you can call `cancelNonces` once and
  list the three nonces.

Bids and asks may specify royalties: for example, to the artist, to the
collection (e.g., Art Blocks), to a broker, to the platform. Royalties specified
in the ask are taken as a cut from the asker's proceeds at no cost to the
bidder; royalties specified in the ask are taken as additional funds from the
bidder at no cost to the asker.

An ask may specify that the seller would like to be paid in ETH rather than
WETH. If so, the market contract will unwrap the buyer's WETH before sending the
proceeds to the seller. This only affects the seller, not any royalty
recipients. Correspondingly, a buyer may choose to pay in ETH rather than WETH
by calling `fillOrderEth`, which will wrap any attached ETH into WETH and send
it to the buyer before filling the order as normal.

## Market

To cover:

- signing domain for bids/asks, both signatures and on-chain approvals
- impact of changes in trait oracle behavior on active traitset bids
- signature discovery service ("mempool")
- attack models: compromise of NFTs or ETH, orders filling with unintended
  semantics
- potential "pauser" role as a global panic button, which can be pre-committed
  to being burned at a later time

## Trait oracle model

To cover:

- interface definition
- opacity of trait semantics

## Art Blocks trait oracle

To cover:

- threat model re: oracle signing key compromise
- threat model re: bad data from the Art Blocks API servers
- project/feature versioning
- feature trait finalization
- bit-packing for `traitMembers` and `traitFinalizations`

## Signatures

To cover:

- dual support for EIP-712 and legacy `\x19Ethereum Signed Message`s
- signing domain scope
- manual EIP-712 encoding in Solidity; cf. struct hash injectivity
