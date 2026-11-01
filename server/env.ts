import type { Address } from 'viem'
import { getUsdc, requireChain } from '../src/onchain-facts'
import { parseUsdc } from '../src/onchain-money'

/** Chain key the sandbox RPC proxy uses for each supported Arc network. */
const PROXY_CHAIN_KEYS: Record<number, string> = {
  5042002: 'Arc_Testnet',
  5042: 'Arc',
}

function getChainId(): number {
  const raw = process.env.VITE_CHAIN_ID
  if (raw && PROXY_CHAIN_KEYS[Number(raw)]) return Number(raw)
  return 5042
}

function resolveRpcUrl(chainId: number): string {
  const key = PROXY_CHAIN_KEYS[chainId] ?? 'Arc'
  const proxied = (process.env.RPC_PROXY_CHAINS ?? '').split(',').includes(key)
  if (process.env.RPC_PROXY_BASE_URL && proxied) {
    return `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${key}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  }
  const chain = requireChain(chainId)
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

export const env = {
  get port(): number {
    return Number(process.env.PORT ?? 3001)
  },
  get chainId(): number {
    return getChainId()
  },
  get chain() {
    return requireChain(this.chainId)
  },
  get chainName(): string {
    return this.chain.name
  },
  get isMainnet(): boolean {
    return !this.chain.isTestnet
  },
  get explorerBase(): string {
    return this.chain.explorerBase
  },
  get rpcUrl(): string {
    return resolveRpcUrl(this.chainId)
  },
  get usdc(): Address {
    const u = getUsdc(this.chainId)
    if (!u) throw new Error(`USDC is not registered for chain ${this.chainId}`)
    return u.address as Address
  },
  get contract(): Address | undefined {
    const c = process.env.VITE_ARCPAY_ADDRESS
    return c && /^0x[0-9a-fA-F]{40}$/.test(c) ? (c as Address) : undefined
  },
  get delegate(): Address | undefined {
    const d = process.env.VITE_DELEGATE_ADDRESS
    return d && /^0x[0-9a-fA-F]{40}$/.test(d) ? (d as Address) : undefined
  },
  /** Hot wallet that submits bot payments. Never logged, never sent to the browser. */
  get relayerKey(): `0x${string}` | undefined {
    const k = process.env.RELAYER_PRIVATE_KEY
    return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as `0x${string}`) : undefined
  },
  /** Gas reimbursement the bot asks per payment, in USDC base units. Capped by each user's own maxFee. */
  get botFee(): bigint {
    return parseBotFee(process.env.BOT_GAS_FEE_USDC)
  },
  /** Bot payments at or above this amount (USDC base units) always need a wallet signature in the web app. */
  get manualSignFrom(): bigint {
    return parseUsdcEnv('BOT_MANUAL_SIGN_FROM_USDC', '50')
  },
  get deployBlock(): bigint | undefined {
    return process.env.ARCPAY_DEPLOY_BLOCK ? BigInt(process.env.ARCPAY_DEPLOY_BLOCK) : undefined
  },
  get databaseUrl(): string | undefined {
    return process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL
  },
  get databaseToken(): string | undefined {
    return process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN
  },
  get botToken(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN
  },
  get appUrl(): string {
    return (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  },
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PAIRING_TTL_MS = 10 * 60 * 1000
export const INTENT_TTL_MS = 30 * 60 * 1000
