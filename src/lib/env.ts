import type { Address } from 'viem'
import { buildTxExplorerUrl, getUsdc, requireChain } from '@/onchain-facts'

/** Selected network. 5042002 = Arc Testnet (default), 5042 = Arc Mainnet. */
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 5042002)

export const CHAIN = requireChain(CHAIN_ID)
export const IS_MAINNET = !CHAIN.isTestnet

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error(`USDC is not registered for chain ${CHAIN_ID}`)
export const USDC_ADDRESS = usdcFact.address as Address

const configured = import.meta.env.VITE_ARCPAY_ADDRESS as string | undefined
export const ARCPAY_ADDRESS: Address | undefined =
  configured && /^0x[0-9a-fA-F]{40}$/.test(configured) ? (configured as Address) : undefined

export const buildTxLink = (txHash: string): string => buildTxExplorerUrl(CHAIN_ID, txHash)

export const shortAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`

/** Payment memo = request id (16 bytes) right-padded to bytes32. Ties the onchain payment to its request. */
export const memoFromIntentId = (id: string): `0x${string}` => `0x${id}${'0'.repeat(64 - id.length)}`
