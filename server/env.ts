import type { Address } from 'viem'
import { getUsdc, requireChain } from '../src/onchain-facts'
import { parseUsdc } from '../src/onchain-money'

/** Chain key the sandbox RPC proxy uses for each supported Arc network. */
const PROXY_CHAIN_KEYS: Record<number, string> = {
  5042002: 'Arc_Testnet',
  5042: 'Arc',
}

const chainId = Number(process.env.VITE_CHAIN_ID ?? 5042002)

if (!PROXY_CHAIN_KEYS[chainId]) {
  throw new Error(`VITE_CHAIN_ID must be 5042002 (Arc Testnet) or 5042 (Arc Mainnet), got ${chainId}`)
}

const chain = requireChain(chainId)
const usdc = getUsdc(chainId)
if (!usdc) throw new Error(`USDC is not registered for chain ${chainId}`)

function resolveRpcUrl(): string {
  const key = PROXY_CHAIN_KEYS[chainId]
  const proxied = (process.env.RPC_PROXY_CHAINS ?? '').split(',').includes(key)
  if (process.env.RPC_PROXY_BASE_URL && proxied) {
    return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${key}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  }
  return process.env.ARC_RPC_URL || chain.rpcUrls[0]
}

function parseUsdcEnv(name: string, fallback: string): bigint {
  try {
    return parseUsdc(process.env[name] ?? fallback)
  } catch {
    throw new Error(`${name} must be a USDC amount with up to 6 decimals, like ${fallback}`)
  }
}

function parseBotFee(value: string | undefined): bigint {
  // Default 0.01 USDC. Arc gas is paid in USDC, so this is the whole reimbursement.
  try {
    return parseUsdc(value ?? '0.01')
  } catch {
    throw new Error('BOT_GAS_FEE_USDC must be a USDC amount with up to 6 decimals, like 0.01')
  }
}

const contract = process.env.VITE_ARCPAY_ADDRESS
const delegate = process.env.VITE_DELEGATE_ADDRESS
const relayerKey = process.env.RELAYER_PRIVATE_KEY
const deployBlock = process.env.ARCPAY_DEPLOY_BLOCK ? BigInt(process.env.ARCPAY_DEPLOY_BLOCK) : undefined

export const env = {
  port: Number(process.env.PORT ?? 3001),
  chainId,
  chainName: chain.name,
  isMainnet: !chain.isTestnet,
  explorerBase: chain.explorerBase,
  rpcUrl: resolveRpcUrl(),
  usdc: usdc.address as Address,
  contract: contract && /^0x[0-9a-fA-F]{40}$/.test(contract) ? (contract as Address) : undefined,
  delegate: delegate && /^0x[0-9a-fA-F]{40}$/.test(delegate) ? (delegate as Address) : undefined,
  /** Hot wallet that submits bot payments. Never logged, never sent to the browser. */
  relayerKey: relayerKey && /^0x[0-9a-fA-F]{64}$/.test(relayerKey) ? (relayerKey as `0x${string}`) : undefined,
  /** Gas reimbursement the bot asks per payment, in USDC base units. Capped by each user's own maxFee. */
  botFee: parseBotFee(process.env.BOT_GAS_FEE_USDC),
  /** Bot payments at or above this amount (USDC base units) always need a wallet signature in the web app. */
  manualSignFrom: parseUsdcEnv('BOT_MANUAL_SIGN_FROM_USDC', '50'),
  deployBlock,
  databaseUrl: process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL,
  databaseToken: process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN,
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  appUrl: (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, ''),
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PAIRING_TTL_MS = 10 * 60 * 1000
export const INTENT_TTL_MS = 30 * 60 * 1000
