// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ITraitOracle.sol";
import "./IRoyaltyOracle.sol";
import "./IWeth.sol";
import "./MarketMessages.sol";
import "./SignatureChecker.sol";

contract ArchipelagoMarket is Ownable {
    using MarketMessages for Ask;
    using MarketMessages for Bid;
    using MarketMessages for OrderAgreement;

    event NonceCancellation(address indexed participant, uint256 indexed nonce);

    event BidApproval(
        address indexed participant,
        bytes32 indexed bidHash,
        bool approved,
        Bid bid
    );
    event AskApproval(
        address indexed participant,
        bytes32 indexed askHash,
        bool approved,
        Ask ask
    );

    event Trade(
        uint256 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 proceeds,
        uint256 cost,
        IERC20 currency
    );
    /// Emitted once for every token that's transferred as part of a trade,
    /// i.e. a Trade event will correspond to one TokenTraded events.
    /// It's part of a separate event so that we can index more fields.
    event TokenTraded(
        uint256 indexed tradeId,
        IERC721 indexed tokenAddress,
        uint256 indexed tokenId
    );

    event RoyaltyPaid(
        uint256 indexed tradeId,
        address indexed payer,
        address indexed recipient,
        uint256 micros,
        uint256 amount,
        IERC20 currency
    );

    mapping(address => mapping(uint256 => bool)) public nonceCancellation;

    /// `onChainApprovals[address][structHash]` is `true` if `address` has
    /// provided on-chain approval of a message with hash `structHash`.
    ///
    /// These approvals are not bounded by a domain separator; the contract
    /// storage itself is the signing domain.
    mapping(address => mapping(bytes32 => bool)) public onChainApprovals;

    /// Whether the market is in emergencyShutdown mode (in which case, no trades
    /// can be made).
    bool emergencyShutdown;

    /// Address of the Archipelago protocol treasury (to which hardcoded
    /// royalties accrue)
    address archipelagoTreasuryAddress;

    /// Royalty rate that accrues to the Archipelago protocol treasury
    /// (expressed as millionths of each transaction value)
    uint256 archipelagoRoyaltyMicros;

    /// Hardcap the Archipelago royalty rate at 50 basis points.
    /// Prevents "rug" attacks where the contract owner unexpectedly
    /// spikes the royalty rate, abusing existing asks. Also, it's a nice
    /// commitment to our users.
    uint256 constant MAXIMUM_PROTOCOL_ROYALTY = 5000;

    uint256 constant ONE_MILLION = 1000000;

    string constant INVALID_ARGS = "Market: invalid args";

    string constant ORDER_CANCELLED_OR_EXPIRED =
        "Market: order cancelled or expired";

    string constant AGREEMENT_MISMATCH =
        "Market: bid or ask's agreement hash doesn't match order agreement";

    string constant TRANSFER_FAILED = "Market: transfer failed";

    bytes32 constant TYPEHASH_DOMAIN_SEPARATOR =
        keccak256(
            "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
        );

    /// Needs to be present so that the WETH contract can send ETH here for
    /// automatic unwrapping on behalf of sellers. No-one else should send
    /// ETH to this contract.
    receive() external payable {}

    /// Shut down the market. Should be used if a critical security
    /// flaw is discovered.
    function setEmergencyShutdown(bool isShutdown) external onlyOwner {
        emergencyShutdown = isShutdown;
    }

    function setTreasuryAddress(address newTreasuryAddress) external onlyOwner {
        archipelagoTreasuryAddress = newTreasuryAddress;
    }

    function setArchipelagoRoyaltyRate(uint256 newRoyaltyRate)
        external
        onlyOwner
    {
        require(
            newRoyaltyRate <= MAXIMUM_PROTOCOL_ROYALTY,
            "protocol royalty too high"
        );
        archipelagoRoyaltyMicros = newRoyaltyRate;
    }

    function computeDomainSeparator() internal view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TYPEHASH_DOMAIN_SEPARATOR,
                    keccak256("ArchipelagoMarket"),
                    block.chainid,
                    address(this)
                )
            );
    }

    function verify(
        bytes32 domainSeparator,
        bytes32 structHash,
        bytes memory signature,
        SignatureKind signatureKind
    ) internal view returns (address) {
        if (signatureKind != SignatureKind.EXTERNAL) {
            return
                SignatureChecker.recover(
                    domainSeparator,
                    structHash,
                    signature,
                    signatureKind
                );
        }
        address signer = abi.decode(signature, (address));
        require(
            onChainApprovals[signer][structHash],
            "Market: on-chain approval missing"
        );
        return signer;
    }

    function setOnChainBidApproval(Bid memory bid, bool approved) external {
        bytes32 hash = bid.structHash();
        onChainApprovals[msg.sender][hash] = approved;
        emit BidApproval(msg.sender, hash, approved, bid);
    }

    function setOnChainAskApproval(Ask memory ask, bool approved) external {
        bytes32 hash = ask.structHash();
        onChainApprovals[msg.sender][hash] = approved;
        emit AskApproval(msg.sender, hash, approved, ask);
    }

    /// Computes the EIP-712 struct hash of the given bid. The resulting hash
    /// can be passed to `onChainApprovals(address, bytes32)` to check whether
    /// a given account has signed this bid.
    function bidHash(Bid memory bid) external pure returns (bytes32) {
        return bid.structHash();
    }

    /// Computes the EIP-712 struct hash of the given ask. The resulting hash
    /// can be passed to `onChainApprovals(address, bytes32)` to check whether
    /// a given account has signed this ask.
    function askHash(Ask memory ask) external pure returns (bytes32) {
        return ask.structHash();
    }

    /// Computes the EIP-712 struct hash of the parts of an order that must be
    /// shared between a bid and an ask. The resulting hash should appear as
    /// the `agreementHash` field of both the `Bid` and the `Ask` structs.
    function orderAgreementHash(OrderAgreement memory agreement)
        external
        pure
        returns (bytes32)
    {
        return agreement.structHash();
    }

    function cancelNonces(uint256[] calldata nonces) external {
        for (uint256 i; i < nonces.length; i++) {
            uint256 nonce = nonces[i];
            nonceCancellation[msg.sender][nonce] = true;
            emit NonceCancellation(msg.sender, nonce);
        }
    }

    function _verifyOrder(
        OrderAgreement memory agreement,
        Bid memory bid,
        bytes memory bidSignature,
        SignatureKind bidSignatureKind,
        Ask memory ask,
        bytes memory askSignature,
        SignatureKind askSignatureKind
    ) internal view returns (address bidder, address asker) {
        bytes32 agreementHash = agreement.structHash();
        require(bid.agreementHash == agreementHash, AGREEMENT_MISMATCH);
        require(ask.agreementHash == agreementHash, AGREEMENT_MISMATCH);

        bytes32 domainSeparator = computeDomainSeparator();
        bidder = verify(
            domainSeparator,
            bid.structHash(),
            bidSignature,
            bidSignatureKind
        );
        asker = verify(
            domainSeparator,
            ask.structHash(),
            askSignature,
            askSignatureKind
        );
    }

    function fillOrder(
        OrderAgreement memory agreement,
        Bid memory bid,
        bytes memory bidSignature,
        SignatureKind bidSignatureKind,
        Ask memory ask,
        bytes memory askSignature,
        SignatureKind askSignatureKind
    ) external {
        (address bidder, address asker) = _verifyOrder(
            agreement,
            bid,
            bidSignature,
            bidSignatureKind,
            ask,
            askSignature,
            askSignatureKind
        );
        _fillOrder(agreement, bid, bidder, ask, asker);
    }

    /// Variant of fill order where the buyer pays in ETH (which is converted to
    /// WETH under the hood). Added as a convenience. Code is mostly a repeat of
    /// fillOrder, since we need to get the bidder from the signature, and then
    /// convert the paid ETH to WETH.
    ///
    /// We don't know exactly how much the order will cost the bidder upfront
    /// (we'd need to calculate royalties). So instead, the bidder just provides
    /// any amount of ETH they want, which will be added to their WETH balance
    /// before attempting to fill the transaction. If they haven't sent enough,
    /// the tx will fail; if they sent extra, they wil have a remaining WETH
    /// balance afterwards, which we assume was their intent (maybe they have
    /// other bids outstanding).
    function fillOrderEth(
        OrderAgreement memory agreement,
        Bid memory bid,
        bytes memory bidSignature,
        SignatureKind bidSignatureKind,
        Ask memory ask,
        bytes memory askSignature,
        SignatureKind askSignatureKind
    ) external payable {
        (address bidder, address asker) = _verifyOrder(
            agreement,
            bid,
            bidSignature,
            bidSignatureKind,
            ask,
            askSignature,
            askSignatureKind
        );
        require(msg.sender == bidder, "only bidder may fill with ETH");
        IWeth currency = IWeth(address(agreement.currencyAddress));
        currency.deposit{value: msg.value}();
        require(currency.transfer(bidder, msg.value), TRANSFER_FAILED);
        _fillOrder(agreement, bid, bidder, ask, asker);
    }

    function _fillOrder(
        OrderAgreement memory agreement,
        Bid memory bid,
        address bidder,
        Ask memory ask,
        address asker
    ) internal {
        require(!emergencyShutdown, "Market is shut down");

        IERC721 token = agreement.tokenAddress;
        uint256 price = agreement.price;
        IERC20 currency = agreement.currencyAddress;

        uint256 tokenId = ask.tokenId;

        require(
            ask.authorizedBidder == address(0) ||
                ask.authorizedBidder == bidder,
            "bidder is not authorized"
        );

        require(block.timestamp <= bid.deadline, ORDER_CANCELLED_OR_EXPIRED);
        require(block.timestamp <= ask.deadline, ORDER_CANCELLED_OR_EXPIRED);

        require(
            !nonceCancellation[bidder][bid.nonce],
            ORDER_CANCELLED_OR_EXPIRED
        );
        require(
            !nonceCancellation[asker][ask.nonce],
            ORDER_CANCELLED_OR_EXPIRED
        );

        // Bids and asks are cancelled on execution, to prevent replays. Cancel
        // upfront so that external calls (`transferFrom`, `safeTransferFrom`,
        // the ERC-721 receive hook) only observe the cancelled state.
        nonceCancellation[bidder][bid.nonce] = true;
        nonceCancellation[asker][ask.nonce] = true;
        emit NonceCancellation(bidder, bid.nonce);
        emit NonceCancellation(asker, ask.nonce);

        uint256 tradeId = uint256(
            keccak256(abi.encode(bidder, bid.nonce, asker, ask.nonce))
        );
        // amount paid to seller, after subtracting asker royalties
        uint256 proceeds = price;
        // amount spent by the buyer, after including bidder royalties
        uint256 cost = price;

        if (address(bid.traitOracle) == address(0)) {
            uint256 expectedTokenId = uint256(bytes32(bid.trait));
            require(expectedTokenId == tokenId, "tokenid mismatch");
        } else {
            require(
                bid.traitOracle.hasTrait(token, tokenId, bid.trait),
                "missing trait"
            );
        }

        for (uint256 i = 0; i < agreement.requiredRoyalties.length; i++) {
            proceeds -= _payRoyalty(
                agreement.requiredRoyalties[i],
                bidder,
                asker,
                price,
                tradeId,
                currency,
                token,
                tokenId
            );
        }
        // Note that the extra royalties on the ask is basically duplicated
        // from the required royalties. If you make a change to one code path,
        // you should also change the other.
        // We're support "extra" asker royalties so that the seller can reward
        // an agent, broker, or advisor, as appropriate.
        for (uint256 i = 0; i < ask.extraRoyalties.length; i++) {
            proceeds -= _payRoyalty(
                ask.extraRoyalties[i],
                bidder,
                asker,
                price,
                tradeId,
                currency,
                token,
                tokenId
            );
        }

        // Finally, we pay the hardcoded protocol royalty. It also comes from
        // the asker, so it's in the same style as the required royalties and
        // asker's extra royalties.
        if (archipelagoTreasuryAddress != address(0)) {
            uint256 amt = (archipelagoRoyaltyMicros * price) / 1000000;
            proceeds -= amt;
            require(
                currency.transferFrom(bidder, archipelagoTreasuryAddress, amt),
                TRANSFER_FAILED
            );
            emit RoyaltyPaid(
                tradeId,
                asker,
                archipelagoTreasuryAddress,
                archipelagoRoyaltyMicros,
                amt,
                currency
            );
        }

        for (uint256 i = 0; i < bid.extraRoyalties.length; i++) {
            // Now we handle bid extra royalties.
            // This time we are increasing the cost (not decreasing the proceeds) and the RoyaltyPaid
            // event will specify the bidder as the entity paying the royalty.
            cost += _payRoyalty(
                bid.extraRoyalties[i],
                bidder,
                bidder,
                price,
                tradeId,
                currency,
                token,
                tokenId
            );
        }

        bool ownerOrApproved;
        address tokenOwner = token.ownerOf(tokenId);
        if (tokenOwner == asker) {
            ownerOrApproved = true;
        } else if (token.getApproved(tokenId) == asker) {
            ownerOrApproved = true;
        } else if (token.isApprovedForAll(tokenOwner, asker)) {
            ownerOrApproved = true;
        }
        require(ownerOrApproved, "asker is not owner or approved");
        token.safeTransferFrom(tokenOwner, bidder, tokenId);
        if (ask.unwrapWeth) {
            require(
                currency.transferFrom(bidder, address(this), proceeds),
                TRANSFER_FAILED
            );
            IWeth(address(currency)).withdraw(proceeds);
            // Note: This invokes the asker's fallback function. Be careful of
            // re-entrancy attacks. We deliberately invalidate the bid and ask
            // nonces before this point, to prevent replay attacks.
            payable(asker).transfer(proceeds);
        } else {
            require(
                currency.transferFrom(bidder, asker, proceeds),
                TRANSFER_FAILED
            );
        }

        emit Trade(tradeId, bidder, asker, price, proceeds, cost, currency);
        emit TokenTraded(tradeId, token, tokenId);
    }

    function _computeRoyalty(
        bytes32 royalty,
        IERC721 tokenContract,
        uint256 tokenId
    ) internal view returns (RoyaltyResult[] memory) {
        address target = address(bytes20(royalty));
        uint32 micros = uint32(uint256(royalty));
        uint32 staticBit = 1 << 31;
        bool isStatic = (micros & (staticBit)) != 0;
        micros &= ~staticBit;
        if (isStatic) {
            RoyaltyResult[] memory results = new RoyaltyResult[](1);
            results[0].micros = micros;
            results[0].recipient = target;
            return results;
        } else {
            uint64 data = uint64(uint256(royalty) >> 32);
            RoyaltyResult[] memory results = IRoyaltyOracle(target).royalties(
                tokenContract,
                tokenId,
                micros,
                data
            );
            uint256 totalMicros = 0;
            for (uint256 i = 0; i < results.length; i++) {
                totalMicros += results[i].micros;
            }
            require(
                totalMicros <= micros,
                "oracle wants to overspend royalty allotment"
            );
            return results;
        }
    }

    function _payComputedRoyalties(
        RoyaltyResult[] memory results,
        address bidder,
        // `logicalPayer` is either the bidder or the asker, depending on who
        // semantically is bearing the cost of this royalty. In all cases, the
        // funds will actually be transferred from the bidder; this only
        // affects the emitted event.
        address logicalPayer,
        uint256 price,
        uint256 tradeId,
        IERC20 currency
    ) internal returns (uint256) {
        uint256 totalAmount;
        for (uint256 i = 0; i < results.length; i++) {
            RoyaltyResult memory result = results[i];
            uint256 amt = (result.micros * price) / ONE_MILLION;
            totalAmount += amt;
            require(
                currency.transferFrom(bidder, result.recipient, amt),
                TRANSFER_FAILED
            );
            emit RoyaltyPaid(
                tradeId,
                logicalPayer,
                result.recipient,
                result.micros,
                amt,
                currency
            );
        }
        return totalAmount;
    }

    function _payRoyalty(
        bytes32 royalty,
        address bidder,
        address logicalPayer,
        uint256 price,
        uint256 tradeId,
        IERC20 currency,
        IERC721 tokenContract,
        uint256 tokenId
    ) internal returns (uint256) {
        RoyaltyResult[] memory results = _computeRoyalty(
            royalty,
            tokenContract,
            tokenId
        );
        return
            _payComputedRoyalties(
                results,
                bidder,
                logicalPayer,
                price,
                tradeId,
                currency
            );
    }
}
