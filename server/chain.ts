import { createPublicClient, erc20Abi, http, isAddress, type Address } from 'viem'
import { arcPayAbi } from '../src/lib/arcpay-abi'
import { env } from './env'

export const publicClient = createPublicClient({ transport: http(env.rpcUrl) })

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
