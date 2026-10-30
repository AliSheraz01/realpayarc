import { parseAbi } from 'viem'

/** ABI of contracts/ArcPay.sol. Shared by the web app and the backend service. */
export const arcPayAbi = parseAbi([
  'function USDC() view returns (address)',
  'function MIN_COMMITMENT_AGE() view returns (uint256)',
  'function MAX_COMMITMENT_AGE() view returns (uint256)',
  'function commitTimestamp(bytes32 commitment) view returns (uint64)',
  'function makeCommitment(string name, address owner, bytes32 salt) pure returns (bytes32)',
  'function commit(bytes32 commitment)',
  'function register(string name, bytes32 salt)',
  'function resolve(string name) view returns (address owner)',
  'function usernameOf(address owner) view returns (string name)',
  'function isValidName(string name) pure returns (bool valid)',
  'function isAvailable(string name) view returns (bool available)',
  'function pay(address to, uint256 amount, bytes32 memo)',
  'function payToUsername(string name, uint256 amount, bytes32 memo)',
  'event UsernameCommitted(address indexed owner, bytes32 indexed commitment)',
  'event UsernameRegistered(address indexed owner, bytes32 indexed nameHash, string name)',
  'event Payment(address indexed from, address indexed to, uint256 amount, bytes32 memo)',
  'error ZeroAddress()',
  'error InvalidName()',
  'error AlreadyRegistered(address account)',
  'error NameTaken(bytes32 nameHash)',
  'error InvalidRecipient(address recipient)',
  'error ZeroAmount()',
  'error UnregisteredUsername()',
  'error CommitmentAlreadyExists(bytes32 commitment)',
  'error CommitmentNotFound(bytes32 commitment)',
  'error CommitmentTooNew(bytes32 commitment, uint256 readyAt)',
  'error CommitmentExpired(bytes32 commitment)',
])

/** Mirrors ArcPay.isValidName so forms can validate before spending gas. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{2,31}$/

/** ABI of contracts/ArcPayDelegate.sol: pre-approved spending limits for the Telegram bot's relayer. */
export const arcPayDelegateAbi = parseAbi([
  'function USDC() view returns (address)',
  'function MAX_DELEGATION_DURATION() view returns (uint256)',
  'function WINDOW() view returns (uint256)',
  'function getDelegation(address owner) view returns (address relayer, uint128 perPaymentLimit, uint128 dailyLimit, uint64 expiry, uint128 maxFee, uint256 remainingToday)',
  'function setDelegation(address relayer, uint128 perPaymentLimit, uint128 dailyLimit, uint64 expiry, uint128 maxFee)',
  'function revokeDelegation()',
  'function payFor(address from, address to, uint256 amount, uint256 fee, bytes32 memo)',
  'event DelegationSet(address indexed owner, address indexed relayer, uint128 perPaymentLimit, uint128 dailyLimit, uint64 expiry, uint128 maxFee)',
  'event DelegationRevoked(address indexed owner, address indexed relayer)',
  'event DelegatedPayment(address indexed from, address indexed to, address indexed relayer, uint256 amount, uint256 fee, bytes32 memo)',
  'error ZeroAddress()',
  'error NotAuthorized()',
  'error NoDelegation()',
  'error DelegationExpired(uint64 expiry)',
  'error InvalidLimits(uint128 perPaymentLimit, uint128 dailyLimit)',
  'error InvalidExpiry(uint64 expiry, uint256 currentTimestamp)',
  'error InvalidFee(uint128 maxFee, uint128 perPaymentLimit)',
  'error FeeTooHigh(uint256 fee, uint128 maxFee)',
  'error InvalidRecipient(address recipient)',
  'error ZeroAmount()',
  'error PerPaymentLimitExceeded(uint256 amount, uint128 limit)',
  'error DailyLimitExceeded(uint256 requested, uint256 remaining)',
])
