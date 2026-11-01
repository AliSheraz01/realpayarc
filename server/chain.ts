import { createPublicClient, erc20Abi, fallback, http, isAddress, type Address, type PublicClient } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { arcPayAbi } from '../src/lib/arcpay-abi'
import { env } from './env'

let cachedRpcUrl: string | null = null
let client: PublicClient | null = null

export function getPublicClient(): PublicClient {
  const rpc = env.rpcUrl
  if (!client || cachedRpcUrl !== rpc) {
    cachedRpcUrl = rpc
    const mainnetUrls = [
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      rpc,
    ]
    const testnetUrls = [
      'https://rpc.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
      rpc,
    ]
    const candidates = env.isMainnet ? mainnetUrls : testnetUrls
    const unique = [...new Set(candidates.filter(Boolean))]
    const transport = fallback(unique.map((url) => http(url, { timeout: 8_000, retryCount: 2 })))

    client = createPublicClient({
      chain: env.isMainnet ? arc : arcTestnet,
      transport,
    })
  }
  return client
}

export const publicClient: PublicClient = new Proxy({} as PublicClient, {
  get(target, prop, receiver) {
    const c = getPublicClient()
    const val = Reflect.get(c, prop, receiver)
    return typeof val === 'function' ? val.bind(c) : val
  },
})

export function requireContract(): Address {
  if (!env.contract) throw new Error('VITE_ARCPAY_ADDRESS is not set. Deploy ArcPay and add its address to .env.')
  return env.contract
}

export async function usdcBalance(wallet: Address): Promise<bigint> {
  return publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] })
}

/** Authoritative on-chain lookup of a registered username. */
export async function resolveOnchainName(name: string): Promise<Address | null> {
  if (!env.contract) return null
  const owner = await publicClient.readContract({
    address: env.contract,
    abi: arcPayAbi,
    functionName: 'resolve',
    args: [name],
  })
  return owner === '0x0000000000000000000000000000000000000000' ? null : owner
}

export async function onchainUsername(wallet: Address): Promise<string> {
  if (!env.contract) return ''
  return publicClient.readContract({
    address: env.contract,
    abi: arcPayAbi,
    functionName: 'usernameOf',
    args: [wallet],
  })
}

export function normalizeAddress(value: string): Address | null {
  return isAddress(value, { strict: false }) ? (value.toLowerCase() as Address) : null
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Payment memo = intent id (16 bytes) right-padded to bytes32. */
export function memoFromIntentId(id: string): `0x${string}` {
  return `0x${id}${'0'.repeat(64 - id.length)}`
}

export function intentIdFromMemo(memo: string): string {
  return memo.replace(/^0x/, '').slice(0, 32)
}
