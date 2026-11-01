import { BaseError, ContractFunctionRevertedError, createWalletClient, erc20Abi, formatEther, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arc, arcTestnet } from 'viem/chains'
import { arcPayDelegateAbi } from '../src/lib/arcpay-abi'
import { formatUsdc } from '../src/onchain-money'
import { publicClient } from './chain'
import { env } from './env'
import { AppError } from './errors'

/**
 * The relayer is the app's hot wallet. It submits `payFor` for users who turned on a spending limit.
 * It can only move a user's USDC inside the limits that user set onchain, and it pays the gas.
 */
export function getRelayerAccount() {
  return env.relayerKey ? privateKeyToAccount(env.relayerKey) : undefined
}

export function getRelayerWalletClient() {
  const account = getRelayerAccount()
  return account
    ? createWalletClient({ account, chain: env.isMainnet ? arc : arcTestnet, transport: http(env.rpcUrl) })
    : undefined
}

export function getRelayerAddress(): Address | null {
  return getRelayerAccount()?.address ?? null
}

export function isDelegationAvailable(): boolean {
  return Boolean(getRelayerAccount() && env.delegate)
}

// Proxied exports for compatibility with modules importing them as values
export const relayerAddress: Address | null = null
export const delegationAvailable = false

/** Below this the relayer cannot reliably pay gas (native view, 18 decimals: 0.01 USDC). */
const MIN_RELAYER_GAS = 10n ** 16n
/** Warn the admin below 0.5 USDC. */
const LOW_RELAYER_GAS = 5n * 10n ** 17n

export interface DelegationState {
  /** Delegation names this app's relayer and has not expired. */
  active: boolean
  relayer: Address
  perPaymentLimit: bigint
  dailyLimit: bigint
  expiry: number
  maxFee: bigint
  remainingToday: bigint
  allowance: bigint
}

/** Payments at or above the threshold must be signed by the user in the web app, whatever their limit says. */
export const requiresSignature = (amount: bigint): boolean => amount >= env.manualSignFrom

export const signatureMessage = (): string =>
  `Payments of ${formatUsdc(env.manualSignFrom)} USDC or more need your signature in the web app.`

/** Gas reimbursement for one payment: the app's flat fee, never above what this user allowed. */
export function feeFor(state: DelegationState): bigint {
  return env.botFee < state.maxFee ? env.botFee : state.maxFee
}

export async function getDelegationState(owner: Address): Promise<DelegationState> {
  if (!env.delegate) throw new AppError('delegation_off', 'Spending limits are not set up on this server.', 503)
  const currentRelayer = getRelayerAddress()
  const [delegation, allowance] = await Promise.all([
    publicClient.readContract({ address: env.delegate, abi: arcPayDelegateAbi, functionName: 'getDelegation', args: [owner] }),
    publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'allowance', args: [owner, env.delegate] }),
  ])
  const [relayer, perPaymentLimit, dailyLimit, expiry, maxFee, remainingToday] = delegation
  const matches = currentRelayer !== null && relayer.toLowerCase() === currentRelayer.toLowerCase()
  return {
    active: matches && Number(expiry) * 1000 > Date.now(),
    relayer,
    perPaymentLimit,
    dailyLimit,
    expiry: Number(expiry),
    maxFee,
    remainingToday,
    allowance,
  }
}

/** Returns why a payment cannot go through the spending limit, or null when it can. */
export function explainBlock(state: DelegationState, amount: bigint, fee: bigint): string | null {
  const total = amount + fee
  if (!state.active) return 'Your spending limit is off or expired.'
  if (total > state.perPaymentLimit) return `That plus the ${formatUsdc(fee)} USDC network fee is above your per-payment limit of ${formatUsdc(state.perPaymentLimit)} USDC.`
  if (total > state.remainingToday) return `That plus the network fee is above what is left of today's limit (${formatUsdc(state.remainingToday)} USDC).`
  if (total > state.allowance) return `The USDC approval for the bot has run out (${formatUsdc(state.allowance)} USDC left). Top it up in the dashboard.`
  return null
}

const REVERT_MESSAGES: Record<string, (args: readonly unknown[] | undefined) => string> = {
  NotAuthorized: () => 'Your spending limit is not active for this bot.',
  NoDelegation: () => 'Your spending limit is off.',
  DelegationExpired: () => 'Your spending limit expired. Turn it on again in the dashboard.',
  FeeTooHigh: () => 'The network fee is above the maximum you allowed.',
  PerPaymentLimitExceeded: () => 'That is above your per-payment limit.',
  DailyLimitExceeded: () => "That is above what is left of today's limit.",
  InvalidRecipient: () => 'That recipient is not valid.',
  ZeroAmount: () => 'Enter an amount greater than zero.',
}

function revertMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name](reverted.data?.args)
      const reason = `${reverted.reason ?? ''} ${reverted.shortMessage}`.toLowerCase()
      if (/allowance/.test(reason)) return 'The USDC approval for the bot has run out. Top it up in the dashboard.'
      if (/balance|exceeds/.test(reason)) return 'Insufficient USDC for this payment.'
    }
  }
  return 'The payment could not be sent. Nothing was moved.'
}

/** Gas level of the bot wallet for the admin. Cached for 30 seconds so health checks stay cheap. */
let gasCache: { at: number; value: { address: Address; balance: string; low: boolean } } | undefined

export async function getRelayerGas(): Promise<{ address: Address; balance: string; low: boolean } | null> {
  const account = getRelayerAccount()
  if (!account) return null
  if (gasCache && Date.now() - gasCache.at < 30_000) return gasCache.value
  const raw = await publicClient.getBalance({ address: account.address })
  // Native view has 18 decimals; show it as USDC. "Low" means fewer than roughly 50 payments left.
  const value = { address: account.address, balance: formatEther(raw), low: raw < LOW_RELAYER_GAS }
  gasCache = { at: Date.now(), value }
  if (value.low) console.warn(`[relayer] LOW GAS: ${account.address} holds ${value.balance} USDC. Top it up so bot payments keep working.`)
  return value
}

// One transaction at a time so the relayer's nonce never collides.
let queue: Promise<unknown> = Promise.resolve()

export function sendDelegated(
  owner: Address,
  to: Address,
  amount: bigint,
  fee: bigint,
  memo: `0x${string}`,
): Promise<`0x${string}`> {
  const run = queue.then(() => submit(owner, to, amount, fee, memo))
  queue = run.catch(() => undefined)
  return run
}

async function submit(owner: Address, to: Address, amount: bigint, fee: bigint, memo: `0x${string}`): Promise<`0x${string}`> {
  // Last line of defence: the relayer itself refuses large amounts, even if a caller forgot to check.
  if (requiresSignature(amount)) throw new AppError('needs_signature', signatureMessage())
  const account = getRelayerAccount()
  const walletClient = getRelayerWalletClient()
  if (!account || !walletClient || !env.delegate) {
    throw new AppError('delegation_off', 'Spending limits are not set up on this server.', 503)
  }

  const gas = await publicClient.getBalance({ address: account.address })
  if (gas < MIN_RELAYER_GAS) {
    console.warn(`[relayer] ${account.address} is almost out of gas funds`)
    throw new AppError('relayer_unfunded', 'The bot payment wallet is out of gas funds. Ask the admin to top it up, or approve this one in your wallet.', 503)
  }

  let request
  try {
    ;({ request } = await publicClient.simulateContract({
      account,
      address: env.delegate,
      abi: arcPayDelegateAbi,
      functionName: 'payFor',
      args: [owner, to, amount, fee, memo],
    }))
  } catch (error) {
    throw new AppError('payment_rejected', revertMessage(error))
  }

  const hash = await walletClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new AppError('tx_failed', 'The payment transaction failed onchain. Nothing was moved.')
  return hash
}
