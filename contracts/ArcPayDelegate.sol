// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ArcPayDelegate
 * @notice Noncustodial delegated USDC payments on Arc with bounded gas reimbursement.
 * @dev TRUST MODEL: Each owner authorizes ONE relayer, which can send the owner's
 * approved USDC to ANY recipient (except zero, this contract, or the owner),
 * bounded only by perPaymentLimit, dailyLimit, expiry, and the owner's USDC
 * allowance to this contract. No per-payment owner signature is required.
 * The relayer can also take up to maxFee per payment as gas reimbursement.
 * Both the payment amount and fee count against the per-payment and daily limits.
 * The owner can stop payments at any time by calling revokeDelegation or setting
 * their USDC allowance to this contract to zero. Approval happens separately on USDC.
 * There is no owner role, admin, pause, or upgrade mechanism.
 * Payments transfer directly from the owner to the recipient and relayer; this contract does
 * not hold funds in its payment flow. Unsolicited token transfers cannot be
 * prevented and there is intentionally no recovery function.
 * The constructor must receive the intended six-decimal USDC ERC-20 on Arc.
 * All amounts are raw token units (1 USDC = 1_000_000); decimals are not converted.
 * Daily limits use rolling, nonoverlapping one-day windows starting at the first
 * payment, not calendar days. Re-setting a delegation explicitly resets its spent
 * accounting, even within an already-spent window, replenishing the full limit.
 * Thus the daily limit is per delegation configuration, not an immutable cap
 * across owner-authorized resets. Relayers cannot perform those resets for owners.
 */
contract ArcPayDelegate {
    using SafeERC20 for IERC20;

    /// @notice The supplied token or relayer address is zero.
    error ZeroAddress();
    /// @notice No delegation exists for the payer, or the caller is not its relayer.
    error NotAuthorized();
    /// @notice The caller has no delegation to revoke.
    error NoDelegation();
    /// @notice The delegation has expired.
    /// @param expiry Last timestamp at which payment was permitted, inclusive.
    error DelegationExpired(uint64 expiry);
    /// @notice The per-payment limit is zero or exceeds the daily limit.
    error InvalidLimits(uint128 perPaymentLimit, uint128 dailyLimit);
    /// @notice The maximum fee exceeds the per-payment limit.
    error InvalidFee(uint128 maxFee, uint128 perPaymentLimit);
    /// @notice Expiry is not in the future or exceeds the maximum duration.
    error InvalidExpiry(uint64 expiry, uint256 currentTimestamp);
    /// @notice The recipient or proposed relayer is disallowed for the operation.
    /// @param recipient Disallowed address supplied by the caller.
    error InvalidRecipient(address recipient);
    /// @notice The requested payment amount is zero.
    error ZeroAmount();
    /// @notice The requested fee exceeds the delegation's maximum fee.
    error FeeTooHigh(uint256 fee, uint128 maxFee);
    /// @notice The payment and fee exceed the delegation's per-payment limit.
    /// @param amount Requested total amount in USDC base units, including the fee.
    /// @param limit Maximum amount permitted per payment.
    error PerPaymentLimitExceeded(uint256 amount, uint128 limit);
    /// @notice The payment and fee exceed the remaining window allowance.
    /// @param requested Requested total amount in USDC base units, including the fee.
    /// @param remaining Unspent amount available in the current window.
    error DailyLimitExceeded(uint256 requested, uint256 remaining);

    /// @notice Maximum delegation lifetime measured from configuration time.
    uint256 public constant MAX_DELEGATION_DURATION = 90 days;
    /// @notice Duration of each spending window.
    uint256 public constant WINDOW = 1 days;

    /// @notice The immutable six-decimal USDC token used for payments.
    IERC20 public immutable USDC;

    /**
     * @dev Four storage slots per owner. Limits share a slot; timestamps and
     * spent amount share another. A zero relayer denotes no delegation.
     * @param relayer Sole address authorized to initiate this owner's payments.
     * @param perPaymentLimit Maximum USDC base units per payment, including the fee.
     * @param dailyLimit Maximum USDC base units per spending window, including fees.
     * @param expiry Inclusive final payment timestamp.
     * @param windowStart Start timestamp of the spending window; zero if unused.
     * @param spentInWindow Amount already spent in the stored window, including fees.
     * @param maxFee Maximum gas reimbursement in USDC base units per payment.
     */
    struct Delegation {
        address relayer;
        uint128 perPaymentLimit;
        uint128 dailyLimit;
        uint64 expiry;
        uint64 windowStart;
        uint128 spentInWindow;
        uint128 maxFee;
    }

    /// @dev Delegations keyed by token owner; exposed only through getDelegation.
    mapping(address => Delegation) private _delegations;

    /**
     * @notice Emitted when an owner creates or replaces a delegation.
     * @param owner Token owner configuring the delegation.
     * @param relayer Sole authorized payment initiator.
     * @param perPaymentLimit Maximum USDC base units per payment, including the fee.
     * @param dailyLimit Maximum USDC base units per spending window, including fees.
     * @param expiry Inclusive final payment timestamp.
     * @param maxFee Maximum gas reimbursement in USDC base units per payment.
     */
    event DelegationSet(
        address indexed owner,
        address indexed relayer,
        uint128 perPaymentLimit,
        uint128 dailyLimit,
        uint64 expiry,
        uint128 maxFee
    );

    /**
     * @notice Emitted when an owner deletes their delegation.
     * @param owner Token owner revoking authorization.
     * @param relayer Previously authorized relayer.
     */
    event DelegationRevoked(address indexed owner, address indexed relayer);

    /**
     * @notice Emitted after a successful direct delegated USDC transfer.
     * @param from Token owner who paid.
     * @param to Recipient who received the tokens.
     * @param relayer Authorized caller who initiated the payment.
     * @param amount Transferred USDC base units.
     * @param fee Gas reimbursement paid to the relayer in USDC base units.
     * @param memo Public, application-defined payment reference.
     */
    event DelegatedPayment(
        address indexed from,
        address indexed to,
        address indexed relayer,
        uint256 amount,
        uint256 fee,
        bytes32 memo
    );

    /**
     * @notice Sets the permanent payment token.
     * @param usdc_ Intended six-decimal USDC ERC-20 on Arc.
     * @dev Reverts with ZeroAddress if usdc_ is zero.
     */
    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        USDC = usdc_;
    }

    /**
     * @notice Authorizes one relayer for the caller, replacing any prior delegation.
     * @param relayer Nonzero relayer, distinct from the caller.
     * @param perPaymentLimit Positive maximum payment including the fee in USDC base units.
     * @param dailyLimit Window limit, at least perPaymentLimit.
     * @param expiry Future inclusive expiry, no more than 90 days from now.
     * @param maxFee Maximum gas reimbursement per payment; zero disables reimbursement.
     * @dev Resets windowStart and spentInWindow to zero, including when replacing
     * an active, already-spent delegation. This owner action replenishes the window
     * allowance; spent accounting is NOT preserved across reconfiguration.
     * Reverts with ZeroAddress, InvalidRecipient, InvalidLimits, InvalidFee, or InvalidExpiry.
     * Does not grant or change the owner's separate USDC allowance.
     */
    function setDelegation(address relayer, uint128 perPaymentLimit, uint128 dailyLimit, uint64 expiry, uint128 maxFee)
        external
    {
        if (relayer == address(0)) revert ZeroAddress();
        if (relayer == msg.sender) revert InvalidRecipient(relayer);
        if (perPaymentLimit == 0 || dailyLimit < perPaymentLimit) revert InvalidLimits(perPaymentLimit, dailyLimit);
        if (maxFee > perPaymentLimit) revert InvalidFee(maxFee, perPaymentLimit);
        if (expiry <= block.timestamp || uint256(expiry) > block.timestamp + MAX_DELEGATION_DURATION) {
            revert InvalidExpiry(expiry, block.timestamp);
        }

        _delegations[msg.sender] = Delegation({
            relayer: relayer,
            perPaymentLimit: perPaymentLimit,
            dailyLimit: dailyLimit,
            expiry: expiry,
            windowStart: 0,
            spentInWindow: 0,
            maxFee: maxFee
        });
        emit DelegationSet(msg.sender, relayer, perPaymentLimit, dailyLimit, expiry, maxFee);
    }

    /**
     * @notice Deletes the caller's delegation, even if expired.
     * @dev Reverts with NoDelegation if none exists. Does not change USDC allowance.
     */
    function revokeDelegation() external {
        address relayer = _delegations[msg.sender].relayer;
        if (relayer == address(0)) revert NoDelegation();
        delete _delegations[msg.sender];
        emit DelegationRevoked(msg.sender, relayer);
    }

    /**
     * @notice Transfers an owner's USDC directly to a recipient using delegation.
     * @param from Token owner who delegated to the caller and approved this contract.
     * @param to Recipient distinct from zero, this contract, and from.
     * @param amount Positive payment in USDC base units.
     * @param fee Gas reimbursement in USDC base units, no more than maxFee.
     * @param memo Public, application-defined payment reference.
     * @dev Checks authorization, expiry, recipient, zero amount, fee, then per-payment
     * limit in that order. Amount plus fee counts against both limits.
     * Rolls an unused or elapsed window before checking its
     * limit. Expiry is inclusive; window rollover occurs at the exact boundary.
     * Updates spent accounting before SafeERC20's external calls, so nested payments
     * observe the updated spend. Token failures revert all accounting changes.
     * No reentrancy guard is needed for this checks-effects-interactions flow with
     * the intended USDC token. SafeERC20 propagates transfer or allowance failures.
     */
    function payFor(address from, address to, uint256 amount, uint256 fee, bytes32 memo) external {
        Delegation storage delegation = _delegations[from];
        if (delegation.relayer == address(0) || msg.sender != delegation.relayer) revert NotAuthorized();
        if (block.timestamp > delegation.expiry) revert DelegationExpired(delegation.expiry);
        if (to == address(0) || to == address(this) || to == from) revert InvalidRecipient(to);
        if (amount == 0) revert ZeroAmount();
        if (fee > delegation.maxFee) revert FeeTooHigh(fee, delegation.maxFee);
        uint256 total = amount + fee;
        if (total > delegation.perPaymentLimit) {
            revert PerPaymentLimitExceeded(total, delegation.perPaymentLimit);
        }

        if (delegation.windowStart == 0 || block.timestamp >= uint256(delegation.windowStart) + WINDOW) {
            // An active uint64 expiry bounds block.timestamp, making this cast safe.
            delegation.windowStart = uint64(block.timestamp);
            delegation.spentInWindow = 0;
        }
        uint256 spent = uint256(delegation.spentInWindow) + total;
        if (spent > delegation.dailyLimit) {
            revert DailyLimitExceeded(total, uint256(delegation.dailyLimit) - delegation.spentInWindow);
        }
        // The daily-limit check bounds spent to uint128 before narrowing.
        delegation.spentInWindow = uint128(spent);

        USDC.safeTransferFrom(from, to, amount);
        if (fee > 0) USDC.safeTransferFrom(from, msg.sender, fee);
        emit DelegatedPayment(from, to, msg.sender, amount, fee, memo);
    }

    /**
     * @notice Returns stored delegation terms and the currently available window limit.
     * @param owner Token owner whose delegation is requested.
     * @return relayer Stored relayer, or zero if no delegation exists.
     * @return perPaymentLimit Stored maximum USDC base units per payment, including the fee.
     * @return dailyLimit Stored maximum USDC base units per window, including fees.
     * @return expiry Stored inclusive final payment timestamp.
     * @return maxFee Stored maximum gas reimbursement in USDC base units per payment.
     * @return remainingToday Zero if absent or expired; otherwise dailyLimit minus
     * current spend, treating an unused or elapsed window as fully fresh.
     * @dev Does not mutate window accounting. Remaining allowance does not account
     * for the owner's USDC balance or ERC-20 allowance and does not guarantee payment.
     */
    function getDelegation(address owner)
        external
        view
        returns (
            address relayer,
            uint128 perPaymentLimit,
            uint128 dailyLimit,
            uint64 expiry,
            uint128 maxFee,
            uint256 remainingToday
        )
    {
        Delegation storage delegation = _delegations[owner];
        relayer = delegation.relayer;
        perPaymentLimit = delegation.perPaymentLimit;
        dailyLimit = delegation.dailyLimit;
        expiry = delegation.expiry;
        maxFee = delegation.maxFee;

        if (relayer != address(0) && block.timestamp <= expiry) {
            if (delegation.windowStart == 0 || block.timestamp >= uint256(delegation.windowStart) + WINDOW) {
                remainingToday = dailyLimit;
            } else {
                remainingToday = uint256(dailyLimit) - delegation.spentInWindow;
            }
        }
    }
}
