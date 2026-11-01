import { authenticate, createNonce, verifySignIn, type AuthContext } from './auth'
import { botStatus, startBot, handleUpdate } from './bot'
import { TelegramApi } from './telegram-api'
import { publicClient } from './chain'
import { connectDb, initSchema, nowIso, type Db } from './db'
import { env } from './env'
import { AppError, rateLimit } from './errors'
import { indexerStatus, ingestTransaction, startIndexer } from './indexer'
import { toRawUsdc } from './parse'
import { delegationAvailable, getDelegationState, getRelayerGas, relayerAddress } from './relayer'
import {
  cancelIntent,
  createIntent,
  createPairingCode,
  getIntent,
  getLinkByWallet,
  getUsername,
  listIntents,
  listPayments,
  resolveRecipient,
  syncUsername,
} from './services'

let db: Db | null = null
let dbError: string | null = null

export function getDb(): Db | null {
  if (db) return db
  if (env.databaseUrl) {
    try {
      db = connectDb(env.databaseUrl, env.databaseToken)
    } catch {
      db = null
    }
  }
  return db
}

if (env.databaseUrl) {
  try {
    db = connectDb(env.databaseUrl, env.databaseToken)
    // schema ready
    console.log('[db] connected, schema ready')
  } catch (error) {
    dbError = error instanceof Error ? error.message : String(error)
    db = null
    console.error('[db] could not connect:', dbError)
  }
} else {
  console.warn('[db] TURSO_DATABASE_URL is not set. Run `bun run setup` to configure Turso. API is in setup mode.')
}

if (import.meta.main && db) {
  if (env.contract) {
    void startIndexer(db)
  } else {
    console.warn('[indexer] VITE_ARCPAY_ADDRESS is not set, payment history indexing is off')
  }
  startBot(db)
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With',
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } })

function requireDb(): Db {
  if (!db) {
    throw new AppError(
      'db_not_configured',
      dbError ? `Database connection failed: ${dbError}` : 'The admin has not configured the database yet (TURSO_DATABASE_URL and TURSO_AUTH_TOKEN).',
      503,
    )
  }
  return db
}

const clientIp = (request: Request): string => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON.')
  }
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = (url.pathname.replace(/\/+$/, '') || '/').replace(/^\/api/, '') || '/'
  const method = request.method

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (method === 'GET' && path === '/health') {
    return json({
      ok: true,
      database: { configured: Boolean(env.databaseUrl), ready: db !== null, error: dbError },
      chain: { id: env.chainId, name: env.chainName, mainnet: env.isMainnet },
      contract: env.contract ?? null,
      bot: { configured: Boolean(env.botToken), running: botStatus.running, username: botStatus.username, error: botStatus.lastError },
      indexer: indexerStatus,
      relayer: await getRelayerGas().catch(() => null),
    })
  }

  if (method === 'GET' && path === '/config') {
    return json({
      chainId: env.chainId,
      contract: env.contract ?? null,
      botUsername: botStatus.username,
      databaseReady: db !== null,
      delegation: { available: delegationAvailable, relayer: relayerAddress, contract: env.delegate ?? null },
    })
  }

  const database = requireDb()

  if (method === 'POST' && path === '/telegram') {
    const update = await readBody<any>(request)
    if (env.botToken) {
      const api = new TelegramApi(env.botToken)
      await handleUpdate(database, api, update).catch((err) => console.error('[bot webhook] error:', err))
    }
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/telegram/setup') {
    if (!env.botToken) throw new AppError('bad_request', 'TELEGRAM_BOT_TOKEN not configured.')
    const api = new TelegramApi(env.botToken)
    const webhookUrl = `${env.appUrl || 'https://realpayarc.vercel.app'}/api/telegram`
    const result = await api.call('setWebhook', { url: webhookUrl })
    return json({ ok: true, webhookUrl, result })
  }

  if (method === 'POST' && path === '/auth/nonce') {
    rateLimit(`nonce:${clientIp(request)}`, 20, 60_000)
    const body = await readBody<{ address: string }>(request)
    return json(await createNonce(database, body.address))
  }

  if (method === 'POST' && path === '/auth/verify') {
    rateLimit(`verify:${clientIp(request)}`, 20, 60_000)
    const body = await readBody<{ address: string; nonce: string; signature: string }>(request)
    return json(await verifySignIn(database, body))
  }

  const auth: AuthContext = await authenticate(database, request)

  if (method === 'POST' && path === '/auth/logout') {
    await database.run('delete from web_sessions where token_hash = ?', [auth.tokenHash])
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/me') {
    const [username, link] = await Promise.all([getUsername(database, auth.wallet), getLinkByWallet(database, auth.wallet)])
    return json({ wallet: auth.wallet, username, telegram: link })
  }

  if (method === 'POST' && path === '/me/sync-username') {
    const username = await syncUsername(database, auth.wallet)
    return json({ username })
  }

  if (method === 'POST' && path === '/pairing') {
    rateLimit(`pairing:${auth.wallet}`, 10, 10 * 60_000)
    const username = await getUsername(database, auth.wallet)
    if (!username) {
      throw new AppError('username_required', 'Register your on-chain username before linking Telegram.', 403)
    }
    return json(await createPairingCode(database, auth.wallet))
  }

  if (method === 'DELETE' && path === '/telegram') {
    await database.run('delete from telegram_links where wallet = ?', [auth.wallet])
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/sessions') {
    const rows = await database.all<{ token_hash: string; created_at: string; last_seen_at: string; expires_at: string }>(
      'select token_hash, created_at, last_seen_at, expires_at from web_sessions where wallet = ? and expires_at > ? order by created_at desc',
      [auth.wallet, nowIso()],
    )
    return json({
      web: rows.map((r) => ({
        id: r.token_hash.slice(0, 16),
        current: r.token_hash === auth.tokenHash,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
      })),
      telegram: await getLinkByWallet(database, auth.wallet),
    })
  }

  if (method === 'POST' && path === '/sessions/revoke-others') {
    await database.run('delete from web_sessions where wallet = ? and token_hash <> ?', [auth.wallet, auth.tokenHash])
    return json({ ok: true })
  }

  if (method === 'POST' && path === '/sessions/revoke-all') {
    await database.run('delete from web_sessions where wallet = ?', [auth.wallet])
    await database.run('delete from telegram_links where wallet = ?', [auth.wallet])
    await database.run('delete from pairing_codes where wallet = ?', [auth.wallet])
    return json({ ok: true })
  }

  if (method === 'GET' && path === '/payments') {
    return json({ payments: await listPayments(database, auth.wallet, 50), indexer: indexerStatus })
  }

  if (method === 'GET' && path === '/delegation') {
    if (!delegationAvailable) {
      return json({ available: false, relayer: relayerAddress, contract: env.delegate ?? null, state: null })
    }
    const state = await getDelegationState(auth.wallet)
    return json({
      available: true,
      relayer: relayerAddress,
      contract: env.delegate,
      botFee: env.botFee.toString(),
      manualSignFrom: env.manualSignFrom.toString(),
      state: {
        active: state.active,
        perPaymentLimit: state.perPaymentLimit.toString(),
        dailyLimit: state.dailyLimit.toString(),
        remainingToday: state.remainingToday.toString(),
        expiry: state.expiry,
        maxFee: state.maxFee.toString(),
        allowance: state.allowance.toString(),
      },
    })
  }

  if (method === 'GET' && path === '/resolve') {
    rateLimit(`resolve:${auth.wallet}`, 60, 60_000)
    const recipient = await resolveRecipient(database, url.searchParams.get('to') ?? '')
    return json(recipient)
  }

  if (method === 'GET' && path === '/intents') {
    return json({ intents: await listIntents(database, auth.wallet) })
  }

  if (method === 'POST' && path === '/intents') {
    rateLimit(`intent:${auth.wallet}`, 30, 60_000)
    const body = await readBody<{ to: string; amount: string }>(request)
    const recipient = await resolveRecipient(database, body.to)
    const intent = await createIntent(database, {
      sender: auth.wallet,
      recipient,
      amount: toRawUsdc(body.amount),
      kind: 'send',
      source: 'web',
    })
    return json({ intent, via: recipient.via })
  }

  const intentMatch = path.match(/^\/intents\/([0-9a-f]{32})(?:\/(submitted|cancel))?$/)
  if (intentMatch) {
    const [, id, action] = intentMatch
    const intent = await getIntent(database, id)
    if (!intent || intent.senderWallet !== auth.wallet) {
      throw new AppError('not_found', 'Payment request not found.', 404)
    }

    if (method === 'GET' && !action) return json({ intent })

    if (method === 'POST' && action === 'cancel') {
      return json({ cancelled: await cancelIntent(database, id, auth.wallet) })
    }

    if (method === 'POST' && action === 'submitted') {
      const body = await readBody<{ txHash: string }>(request)
      if (!/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) throw new AppError('bad_request', 'Invalid transaction hash.')
      if (intent.status !== 'pending' && intent.status !== 'submitted') {
        throw new AppError('not_pending', `This request is already ${intent.status}.`, 409)
      }
      await database.run("update payment_intents set status = 'submitted', tx_hash = ? where id = ?", [body.txHash, id])
      void watchSubmission(database, id, body.txHash as `0x${string}`)
      return json({ ok: true })
    }
  }

  throw new AppError('not_found', 'Unknown route.', 404)
}

async function watchSubmission(database: Db, intentId: string, txHash: `0x${string}`): Promise<void> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 })
    if (receipt.status === 'success') {
      await ingestTransaction(database, txHash)
    } else {
      await database.run("update payment_intents set status = 'failed' where id = ? and status = 'submitted'", [intentId])
    }
  } catch (error) {
    console.warn('[api] could not confirm submission', txHash, error instanceof Error ? error.message : error)
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    return await route(request)
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.code, message: error.message }, error.status)
    console.error('[api] unexpected error:', error)
    return json({ error: 'internal', message: error instanceof Error ? error.message : 'Unexpected server error.' }, 500)
  }
}

declare const Bun: any

if (import.meta.main && typeof Bun !== 'undefined' && typeof Bun.serve === 'function') {
  Bun.serve({
  port: env.port,
  hostname: '0.0.0.0',
  async fetch(request: Request) {
    try {
      return await route(request)
    } catch (error) {
      if (error instanceof AppError) return json({ error: error.code, message: error.message }, error.status)
      console.error('[api] unexpected error:', error)
      return json({ error: 'internal', message: error instanceof Error ? error.message : 'Unexpected server error.' }, 500)
    }
  },
})

  console.log(`[api] listening on :${env.port} (${env.chainName}, chain ${env.chainId})`)
}
