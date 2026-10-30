/**
 * Admin setup. Asks for the Turso database URL and auth token (required), optional Telegram bot token and
 * public app URL, verifies the database connection, writes the answers to .env, and creates the tables.
 *
 *   bun run setup
 *
 * Nothing is echoed back and no secret is printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { connectDb, initSchema } from '../server/db'

const ENV_PATH = new URL('../.env', import.meta.url).pathname

function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(ENV_PATH)) return map
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) map.set(match[1], match[2])
  }
  return map
}

function writeEnvFile(map: Map<string, string>): void {
  writeFileSync(ENV_PATH, [...map].map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
}

function ask(question: string, current?: string): string {
  const hint = current ? ' (press Enter to keep the current value)' : ''
  const answer = prompt(`${question}${hint}:`)?.trim()
  return answer || current || ''
}

const env = readEnvFile()
console.log('\nArcPay admin setup\n')

let databaseUrl = ''
let databaseToken = ''
for (;;) {
  databaseUrl = ask('Turso database URL (libsql://your-db.turso.io, from `turso db show <name> --url`)', env.get('TURSO_DATABASE_URL'))
  if (!/^(libsql|https?|wss?):\/\/|^file:/.test(databaseUrl)) {
    console.error('That does not look like a Turso URL. It should start with libsql://\n')
    continue
  }
  const remote = !databaseUrl.startsWith('file:')
  databaseToken = remote ? ask('Turso auth token (from `turso db tokens create <name>`)', env.get('TURSO_AUTH_TOKEN')) : ''
  if (remote && !databaseToken) {
    console.error('A Turso auth token is required for a remote database.\n')
    continue
  }
  try {
    const db = connectDb(databaseUrl, databaseToken)
    await initSchema(db)
    db.close()
    console.log('Connected. Tables are ready.\n')
    break
  } catch (error) {
    console.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}
env.set('TURSO_DATABASE_URL', databaseUrl)
if (databaseToken) env.set('TURSO_AUTH_TOKEN', databaseToken)

const token = ask('Telegram bot token from @BotFather (leave empty to skip the bot)', env.get('TELEGRAM_BOT_TOKEN'))
if (token) env.set('TELEGRAM_BOT_TOKEN', token)

const appUrl = ask('Public https URL of this web app (used for payment links in Telegram)', env.get('PUBLIC_APP_URL'))
if (appUrl) env.set('PUBLIC_APP_URL', appUrl.replace(/\/+$/, ''))

const network = ask('Network: 5042002 for Arc Testnet or 5042 for Arc Mainnet', env.get('VITE_CHAIN_ID') ?? '5042002')
if (network !== '5042002' && network !== '5042') {
  console.error('Network must be 5042002 or 5042. Keeping the previous value.')
} else {
  env.set('VITE_CHAIN_ID', network)
}

const contract = ask('Deployed ArcPay contract address (run `bun run deploy:testnet` or `deploy:mainnet` to get one)', env.get('VITE_ARCPAY_ADDRESS'))
if (/^0x[0-9a-fA-F]{40}$/.test(contract)) env.set('VITE_ARCPAY_ADDRESS', contract)

writeEnvFile(env)
console.log('\nSaved to .env. Start the backend with `bun run server` and the web app with `bun run dev`.')
