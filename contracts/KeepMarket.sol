// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/// @title Keep Market
/// @notice The Sealed Market's on-chain settlement + access layer. A listing sells
/// DECRYPTION RIGHTS to a sealed memory (the seller keeps their memory; many buyers
/// can buy access) — so this is a per-buyer purchase RECORD, not a 1:1 NFT transfer
/// (closer to ERC-7857's `iClone` than `iTransfer`). The point: the authorization to
/// decrypt becomes a trustless, immutable on-chain fact that anyone can verify, instead
/// of a flag in the server's JSON. The decryption key itself stays server-custodied for
/// now (re-encrypting it to the buyer, ERC-7857-style, is the next step) — so this layer
/// is honestly "trustless WHO-may-decrypt", not yet "trustless key custody".
///
/// Two purchase rails, by design:
///  - recordPurchase(): the app backend (owner/relayer) records a purchase on the
///    buyer's cookie-authenticated authorization — gas-abstracted, mirroring Keep's
///    gasless mint (the relayer already mints memories TO users). No value moves; this
///    makes access a public on-chain fact and works without the buyer holding gas.
///  - buy(): a permissionless, buyer-FUNDED purchase — the buyer pays native OG, which
///    is credited to the seller via a pull-payment ledger. This is the real "buyer pays
///    the seller" rail, live the moment a buyer wallet holds OG.
///
/// TRUST BOUNDARY (same as KeepMemory.mintMemory): recordPurchase is onlyOwner, so an
/// on-chain record asserts "the relayer attests this buyer purchased". That is exactly
/// the trust level the rest of Keep already runs on. buy() needs no such trust — value
/// and the record are bound in one buyer-signed transaction.
contract KeepMarket is Ownable, ReentrancyGuard {
    using Address for address payable;

    struct Listing {
        address seller; // who listed it (proceeds + the one address that can't "buy")
        uint256 price;  // native OG, in wei; 0 = free / display-only price
        bool exists;
    }

    mapping(bytes32 => Listing) public listings;                    // listingId -> listing
    mapping(bytes32 => mapping(address => bool)) public purchased;  // listingId -> buyer -> bought
    mapping(address => uint256) public pendingWithdrawals;          // seller -> withdrawable OG (pull-payment)

    event Listed(bytes32 indexed listingId, address indexed seller, uint256 price);
    event Purchased(
        bytes32 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 pricePaid, // wei actually paid (0 on the relayed/record path)
        bool relayed       // true = recordPurchase (gas-abstracted), false = buyer-funded buy()
    );
    event Withdrawn(address indexed seller, uint256 amount);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Register (or re-price) a listing. onlyOwner = the relayer lists on behalf
    /// of the seller, so listing is gasless for the seller (same model as mint). The
    /// seller is fixed once set; only the price may change on a re-list.
    function list(bytes32 listingId, address seller, uint256 price) external onlyOwner {
        require(seller != address(0), "zero seller");
        Listing storage l = listings[listingId];
        if (l.exists) {
            require(l.seller == seller, "seller immutable");
            l.price = price;
        } else {
            listings[listingId] = Listing({ seller: seller, price: price, exists: true });
        }
        emit Listed(listingId, seller, price);
    }

    /// @notice Buyer-FUNDED purchase: the caller pays native OG and the full amount is
    /// credited to the seller (pull-payment — the seller later withdraw()s). Permissionless.
    /// The buyer's own transaction binds payment + access record together (no relayer trust).
    function buy(bytes32 listingId, uint256 expectedPrice) external payable nonReentrant {
        Listing memory l = listings[listingId];
        require(l.exists, "no listing");
        require(msg.sender != l.seller, "seller cannot buy");
        // Idempotent: an address that already has access (via buy() OR a relayed
        // recordPurchase) cannot be charged again — kills double-charge across rails.
        require(!purchased[listingId][msg.sender], "already purchased");
        // Buyer commits to the price they saw: if the owner re-prices between the quote
        // and settlement, the buy reverts cleanly instead of charging a surprise amount.
        require(l.price == expectedPrice, "price changed");
        // Exact payment: a buyer can never silently overpay; surplus is rejected, not
        // pocketed by the seller.
        require(msg.value == l.price, "wrong price");

        purchased[listingId][msg.sender] = true;
        pendingWithdrawals[l.seller] += msg.value;

        emit Purchased(listingId, msg.sender, l.seller, msg.value, false);
    }

    /// @notice Relayer-settled purchase RECORD on the buyer's authenticated authorization.
    /// Records access on-chain (gas-abstracted) without moving value — turning the unlock
    /// gate from a server flag into a verifiable on-chain fact. Idempotent.
    function recordPurchase(bytes32 listingId, address buyer) external onlyOwner {
        require(buyer != address(0), "zero buyer");
        Listing memory l = listings[listingId];
        require(l.exists, "no listing");
        // Free/paid invariant on-chain (not just in the backend): the relayer may only
        // grant gas-free access to FREE listings; a priced listing must be paid via buy().
        require(l.price == 0, "priced listing: buyer must use buy()");
        require(buyer != l.seller, "seller already has access");

        purchased[listingId][buyer] = true;
        emit Purchased(listingId, buyer, l.seller, 0, true);
    }

    /// @notice The single on-chain fact the unlock gate reads: may `buyer` decrypt?
    function hasPurchased(bytes32 listingId, address buyer) external view returns (bool) {
        return purchased[listingId][buyer];
    }

    /// @notice Seller withdraws accumulated buyer-funded proceeds. Pull-payment with
    /// checks-effects-interactions + nonReentrant: zero the balance BEFORE sending.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).sendValue(amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice The relayer (owner) must keep ownership to list and record purchases, so
    /// renouncing it would permanently brick the market. Disabled (use transferOwnership).
    function renounceOwnership() public override onlyOwner {
        revert("ownership required");
    }
}
