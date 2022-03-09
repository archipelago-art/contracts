// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "./IRoyaltyOracle.sol";

/// Upstream royalty data interface implemented by Art Blocks contracts at
/// mainnet 0xa7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270 (standard) and
/// 0x059edd72cd353df5106d2b9cc5ab83a52287ac3a (legacy).
interface IArtblocksRoyaltyDataSource {
    function artblocksAddress() external view returns (address);

    function getRoyaltyData(uint256 _tokenId)
        external
        view
        returns (
            address artistAddress,
            address additionalPayee,
            uint256 additionalPayeePercentage,
            uint256 royaltyFeeByID
        );
}

contract ArtblocksRoyaltyOracle is IRoyaltyOracle {
    string constant ERR_PLATFORM_ROYALTY_TOO_HIGH =
        "ArtblocksRoyaltyOracle: Art Blocks platform royalty exceeds total royalty";

    // There are three potential payees: the Art Blocks platform, the primary
    // artist, and the secondary artist.
    //
    // A fixed number of micros (specified in the `_data` parameter, and not to
    // exceed the total `_micros`) will be allocated to the Art Blocks
    // platform. The rest will be divided between the primary and secondary
    // artists according to the split percentage returned by `getRoyaltyData`,
    // which is clamped between `0` and `100` (i.e., splits higher than 100%
    // are treated as 100%).
    //
    // For example, if `_data == uint64(25000)` and `_micros == uint64(75000)`,
    // then a 2.5% royalty will be paid to Art Blocks and a 5% royalty will be
    // either paid to the sole artist or split between the two artists.
    //
    // Any payee address may be null. If the Art Blocks platform payee is null,
    // the platform royalty will be dropped. If both artists are null, the
    // artist royalty will be dropped. If exactly one artist is null, their
    // share will be allocated to the other artist. In no circumstance will a
    // royalty be paid to the zero address. If a call to `artblocksAddress` or
    // `getRoyaltyData` fails, the associated payees will be treated as null.
    function royalties(
        IERC721 _tokenContract,
        uint256 _tokenId,
        uint32 _micros,
        uint64 _data
    ) external view returns (RoyaltyResult[] memory) {
        IArtblocksRoyaltyDataSource _dataSource = IArtblocksRoyaltyDataSource(
            address(_tokenContract)
        );

        if (uint256(_data) > uint256(_micros))
            revert(ERR_PLATFORM_ROYALTY_TOO_HIGH);
        uint32 _microsToArtblocks = uint32(_data);
        uint32 _microsToArtists = _micros - _microsToArtblocks;

        address _artblocks = _getArtblocksAddress(_dataSource);
        if (_artblocks == address(0)) {
            _microsToArtblocks = 0;
            // Note: `_microsToArtists` has already been set; artists don't get
            // a higher royalty share just because the platform royalty payee
            // is null.
        }

        (
            address _artist0,
            address _artist1,
            uint256 _artist1Percentage,
            uint256 _unusedRoyaltyFeeById
        ) = _getRoyaltyData(_dataSource, _tokenId);
        // Unused: `royaltyFeeByID` is meant to be an artist-specified total
        // royalty amount (as a percentage of sale price), but other
        // marketplaces don't actually honor this, so many projects have it set
        // to zero---presumably unintentionally. We don't want to unfairly
        // leave those artists out to dry, so we instead determine the total
        // royalty amount by the standard `_micros` argument to this function
        // (after subtracting the Art Blocks platform fee).
        _unusedRoyaltyFeeById;

        // If the primary artist is the null address or would get nothing
        // because the split is too high, promote the secondary artist to
        // primary. (If this would make the primary artist null, we'll pay no
        // artist royalties at all; we may still pay Art Blocks royalties.)
        if (_artist0 == address(0) || _artist1Percentage >= 100) {
            _artist0 = _artist1;
            _artist1Percentage = 0;
        }
        // If the secondary artist is the null address, ignore it.
        if (_artist1 == address(0)) _artist1Percentage = 0;

        // See which royalties we're actually going to pay.
        bool _hasArtblocks = _microsToArtblocks > 0;
        bool _hasArtist0 = _microsToArtists > 0 && _artist0 != address(0);
        bool _hasArtist1 = _hasArtist0 && _artist1Percentage > 0;

        // Allocate appropriately sized return array.
        uint256 _nPayees = 0;
        if (_hasArtblocks) _nPayees++;
        if (_hasArtist0) _nPayees++;
        if (_hasArtist1) _nPayees++;
        RoyaltyResult[] memory _result = new RoyaltyResult[](_nPayees);

        // Populate royalty entries.
        uint256 _nextRoyalty = 0;
        if (_hasArtblocks) {
            RoyaltyResult memory _royalty = _result[_nextRoyalty++];
            _royalty.recipient = _artblocks;
            _royalty.micros = _microsToArtblocks;
        }
        // This cast is lossless because `_micros` is a `uint32` and
        // `_artist1Percentage` is at most `100`.
        uint32 _microsToArtist0 = uint32(
            (uint256(_microsToArtists) * (100 - _artist1Percentage)) / 100
        );
        if (_hasArtist0) {
            RoyaltyResult memory _royalty = _result[_nextRoyalty++];
            _royalty.recipient = _artist0;
            _royalty.micros = _microsToArtist0;
        }
        if (_hasArtist1) {
            RoyaltyResult memory _royalty = _result[_nextRoyalty++];
            _royalty.recipient = _artist1;
            _royalty.micros = _microsToArtists - _microsToArtist0;
        }
        return _result;
    }

    /// Infallibly gets the Art Blocks payee address, which may be null if the
    /// external call fails.
    function _getArtblocksAddress(IArtblocksRoyaltyDataSource _dataSource)
        internal
        view
        returns (address)
    {
        try _dataSource.artblocksAddress() returns (address _artblocksAddress) {
            return _artblocksAddress;
        } catch {
            return address(0);
        }
    }

    /// Infallibly gets the royalty data for a token, which may be null if the
    /// external call fails.
    function _getRoyaltyData(
        IArtblocksRoyaltyDataSource _dataSource,
        uint256 _tokenId
    )
        internal
        view
        returns (
            address artistAddress,
            address additionalPayee,
            uint256 additionalPayeePercentage,
            uint256 royaltyFeeByID
        )
    {
        try _dataSource.getRoyaltyData(_tokenId) returns (
            address _artistAddress,
            address _additionalPayee,
            uint256 _additionalPayeePercentage,
            uint256 _royaltyFeeByID
        ) {
            return (
                _artistAddress,
                _additionalPayee,
                _additionalPayeePercentage,
                _royaltyFeeByID
            );
        } catch {
            return (address(0), address(0), 0, 0);
        }
    }
}
