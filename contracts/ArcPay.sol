// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ArcPay
 * @notice Permanent username registry and fee-free USDC payment router for Arc.
 * @dev Registration uses commit/reveal: commit a hash, then reveal the name
 * and salt after at least 5 seconds and within 1 day. The commitment binds
 * the name, registering wallet, and salt.
 * Names cannot be released or transferred. There is no owner, admin, pause,
 * or upgrade mechanism. Payments move directly from the caller to the recipient;
 * this contract never takes custody in its payment flow. Unsolicited ERC-20
 * transfers cannot be prevented and there is intentionally no recovery function.
 * The constructor token must be the intended six-decimal USDC ERC-20 on Arc;
 * amounts are raw token units (1 USDC = 1_000_000), with no decimal conversion.
 */
contract ArcPay {
    using SafeERC20 for IERC20;

    /// @notice The constructor token address is zero.
    error ZeroAddress();
    /// @notice The username does not satisfy the naming rules.
    error InvalidName();
    /// @notice The caller already owns a permanent username.
    error AlreadyRegistered(address account);
    /// @notice The username is already registered.
    error NameTaken(bytes32 nameHash);
    /// @notice The recipient is zero, this contract, or the caller.
    error InvalidRecipient(address recipient);
    /// @notice The payment amount is zero.
    error ZeroAmount();
    /// @notice No owner is registered for the supplied username.
    error UnregisteredUsername();
    /// @notice The commitment already exists and has not expired.
    error CommitmentAlreadyExists(bytes32 commitment);
    /// @notice No stored commitment matches the reveal.
    error CommitmentNotFound(bytes32 commitment);
    /// @notice The commitment cannot yet be revealed.
    error CommitmentTooNew(bytes32 commitment, uint256 readyAt);
    /// @notice The commitment's reveal window has elapsed.
    error CommitmentExpired(bytes32 commitment);

    /// @notice Minimum delay between committing and revealing a username.
    uint256 public constant MIN_COMMITMENT_AGE = 5 seconds;
    /// @notice Maximum delay between committing and revealing a username.
    uint256 public constant MAX_COMMITMENT_AGE = 1 days;

    /// @notice Timestamp for each commitment, or zero if absent.
    mapping(bytes32 => uint64) public commitTimestamp;

    /// @notice The immutable USDC ERC-20 used for all payments.
    IERC20 public immutable USDC;

    /// @notice Registered owner for a username hash, or zero if unregistered.
    mapping(bytes32 => address) public ownerOfHash;

    /// @dev Each wallet's permanent username; empty means unregistered.
    mapping(address => string) private nameOfOwner;

    /// @notice Emitted when a wallet submits a username commitment.
    event UsernameCommitted(address indexed owner, bytes32 indexed commitment);

    /**
     * @notice Emitted when a wallet permanently registers a username.
     * @param owner Wallet that registered the name.
     * @param nameHash Keccak-256 hash of the exact username bytes.
     * @param name Registered lowercase username.
     */
    event UsernameRegistered(address indexed owner, bytes32 indexed nameHash, string name);

    /**
     * @notice Emitted after a successful direct USDC payment.
     * @param from Wallet that paid.
     * @param to Wallet that received the payment.
     * @param amount Amount in six-decimal USDC base units.
     * @param memo Application-defined public payment reference.
     */
    event Payment(address indexed from, address indexed to, uint256 amount, bytes32 memo);

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
     * @notice Computes a commitment binding a username, wallet, and salt.
     * @param name Exact username to register.
     * @param owner Wallet that will reveal and own the username.
     * @param salt Secret random value used to conceal the username.
     */
    function makeCommitment(string calldata name, address owner, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(name, owner, salt));
    }

    /**
     * @notice Stores a username commitment, replacing it only if expired.
     * @param commitment Hash returned by makeCommitment.
     */
    function commit(bytes32 commitment) external {
        uint64 timestamp = commitTimestamp[commitment];
        if (timestamp != 0 && block.timestamp <= uint256(timestamp) + MAX_COMMITMENT_AGE) {
            revert CommitmentAlreadyExists(commitment);
        }
        commitTimestamp[commitment] = uint64(block.timestamp);
        emit UsernameCommitted(msg.sender, commitment);
    }

    /**
     * @notice Reveals a commitment and permanently registers one username for the caller.
     * @param name Exact lowercase ASCII username to register.
     * @param salt Secret value used to create the commitment for the caller.
     * @dev Requires a commitment aged at least MIN_COMMITMENT_AGE and at most
     * MAX_COMMITMENT_AGE. Deletes it before validating and registering the name.
     * Reverts with InvalidName, AlreadyRegistered, or NameTaken for registry checks.
     * Performs all checks before writing either registry entry; makes no calls.
     */
    function register(string calldata name, bytes32 salt) external {
        bytes32 commitment = makeCommitment(name, msg.sender, salt);
        uint64 timestamp = commitTimestamp[commitment];
        if (timestamp == 0) revert CommitmentNotFound(commitment);
        uint256 readyAt = uint256(timestamp) + MIN_COMMITMENT_AGE;
        if (block.timestamp < readyAt) revert CommitmentTooNew(commitment, readyAt);
        if (block.timestamp > uint256(timestamp) + MAX_COMMITMENT_AGE) {
            revert CommitmentExpired(commitment);
        }
        delete commitTimestamp[commitment];

        if (!isValidName(name)) revert InvalidName();
        if (bytes(nameOfOwner[msg.sender]).length != 0) revert AlreadyRegistered(msg.sender);

        bytes32 nameHash = keccak256(bytes(name));
        if (ownerOfHash[nameHash] != address(0)) revert NameTaken(nameHash);

        ownerOfHash[nameHash] = msg.sender;
        nameOfOwner[msg.sender] = name;
        emit UsernameRegistered(msg.sender, nameHash, name);
    }

    /**
     * @notice Looks up an exact username without normalizing or validating it.
     * @param name Username bytes to look up; invalid names do not cause a revert.
     * @return owner Registered owner, or zero if not registered.
     */
    function resolve(string calldata name) external view returns (address owner) {
        return ownerOfHash[keccak256(bytes(name))];
    }

    /**
     * @notice Returns a wallet's permanent username.
     * @param owner Wallet to look up.
     * @return name Registered username, or the empty string if none.
     */
    function usernameOf(address owner) external view returns (string memory name) {
        return nameOfOwner[owner];
    }

    /**
     * @notice Checks the exact username bytes without normalization.
     * @param name Username to validate.
     * @return valid True for 3..32 bytes of [a-z0-9_], starting with [a-z0-9].
     * @dev Uppercase and all non-ASCII bytes are rejected.
     */
    function isValidName(string calldata name) public pure returns (bool valid) {
        bytes calldata value = bytes(name);
        uint256 length = value.length;
        if (length < 3 || length > 32) return false;

        for (uint256 i; i < length; ) {
            bytes1 character = value[i];
            bool alphanumeric = (character >= 0x61 && character <= 0x7a)
                || (character >= 0x30 && character <= 0x39);
            if (!alphanumeric && (i == 0 || character != 0x5f)) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    /**
     * @notice Checks whether a username is valid and unregistered.
     * @param name Exact username to check.
     * @return available True only if valid and not taken.
     */
    function isAvailable(string calldata name) external view returns (bool available) {
        return isValidName(name) && ownerOfHash[keccak256(bytes(name))] == address(0);
    }

    /**
     * @notice Sends USDC directly from the caller to a wallet.
     * @param to Recipient wallet, distinct from zero, this contract, and caller.
     * @param amount Positive amount in six-decimal USDC base units.
     * @param memo Public application-defined payment reference.
     * @dev Caller must first approve this contract to spend the amount.
     * Reverts with InvalidRecipient or ZeroAmount for invalid payment inputs.
     */
    function pay(address to, uint256 amount, bytes32 memo) external {
        _pay(to, amount, memo);
    }

    /**
     * @notice Sends USDC directly from the caller to a registered username owner.
     * @param name Exact registered username; no normalization is performed.
     * @param amount Positive amount in six-decimal USDC base units.
     * @param memo Public application-defined payment reference.
     * @dev Reverts with UnregisteredUsername if unresolved, then applies pay's
     * recipient and amount checks. Caller must approve this contract first.
     */
    function payToUsername(string calldata name, uint256 amount, bytes32 memo) external {
        address to = ownerOfHash[keccak256(bytes(name))];
        if (to == address(0)) revert UnregisteredUsername();
        _pay(to, amount, memo);
    }

    /**
     * @dev Checks inputs before the sole external interaction. There is no payment
     * accounting state or pending effect to protect with a reentrancy guard.
     * SafeERC20 propagates token failures; Payment is emitted only on success.
     * @param to Resolved recipient.
     * @param amount USDC base units to transfer.
     * @param memo Public payment reference.
     */
    function _pay(address to, uint256 amount, bytes32 memo) internal {
        if (to == address(0) || to == address(this) || to == msg.sender) revert InvalidRecipient(to);
        if (amount == 0) revert ZeroAmount();

        USDC.safeTransferFrom(msg.sender, to, amount);
        emit Payment(msg.sender, to, amount, memo);
    }
}
