/**
 * Creates the bot's payment wallet (the "relayer") and stores its key in .env as RELAYER_PRIVATE_KEY.
 * Only the public address is printed. If a key already exists nothing is changed.
 *
 *   bun run relayer:create
 *
 * Fund the printed address with a little USDC for gas. It never needs to hold user funds.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const envPath = fileURLToPath(new URL('../.env', import.meta.url))
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const existing = current.match(/^RELAYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1]

if (existing) {
  console.log(`A relayer key already exists in .env. Its address is ${privateKeyToAccount(existing as `0x${string}`).address}`)
} else {
  const key = generatePrivateKey()
  appendFileSync(envPath, `${current.endsWith('\n') || current === '' ? '' : '\n'}RELAYER_PRIVATE_KEY=${key}\n`, { mode: 0o600 })
  console.log(`Created the relayer wallet. Address: ${privateKeyToAccount(key).address}`)
  console.log('The key was saved to .env (never commit it). Fund this address with a little USDC for gas.')
}
