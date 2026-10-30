import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { formatUsdc } from '../src/onchain-money'
import { sha256 } from './auth'
import { normalizeAddress, onchainUsername, resolveOnchainName, shortAddress, usdcBalance } from './chain'
import { isoIn, nowIso, type Db } from './db'
import { INTENT_TTL_MS, PAIRING_TTL_MS } from './env'
import { AppError } from './errors'

/** Leave this much USDC for network fees: on Arc, gas is paid in the same USDC balance. */
export const GAS_RESERVE = 50_000n

// ---------- users & links ----------

export interface TelegramLink {
  telegramId: number
  wallet: Address
  telegramUsername: string | null
  linkedAt: string
}

interface LinkRow {
  telegram_id: number
  wallet: string
  telegram_username: string | null
  linked_at: string
}

function toLink(row: LinkRow): TelegramLink {
  return {
    telegramId: Number(row.telegram_id),
    wallet: row.wallet as Address,
    telegramUsername: row.telegram_username ?? null,
    linkedAt: row.linked_at,
  }
}

export async function getLinkByTelegram(db: Db, telegramId: number): Promise<TelegramLink | null> {
  const row = await db.get<LinkRow>(
    'select telegram_id, wallet, telegram_username, linked_at from telegram_links where telegram_id = ?',
    [telegramId],
  )
  return row ? toLink(row) : null
}

export async function getLinkByWallet(db: Db, wallet: string): Promise<TelegramLink | null> {
  const row = await db.get<LinkRow>(
    'select telegram_id, wallet, telegram_username, linked_at from telegram_links where wallet = ?',
    [wallet],
  )
  return row ? toLink(row) : null
}

export async function getUsername(db: Db, wallet: string): Promise<string | null> {
  const row = await db.get<{ username: string | null }>('select username from users where wallet = ?', [wallet])
  return row?.username ?? null
}

/** Reads the registry on-chain and mirrors the result into the database. */
export async function syncUsername(db: Db, wallet: Address): Promise<string | null> {
  const name = await onchainUsername(wallet)
  if (!name) return null
  await db.run(
    'insert into users (wallet, username) values (?, ?) on conflict (wallet) do update set username = excluded.username',
    [wallet, name],
  )
  return name
}

// ---------- pairing ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizeCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const body = cleaned.startsWith('ARC') ? cleaned.slice(3) : cleaned
  return body.length === 12 && [...body].every((c) => CODE_ALPHABET.includes(c)) ? body : null
}

export function looksLikePairingCode(input: string): boolean {
  return normalizeCode(input.trim()) !== null && /^ARC[-\s]?/i.test(input.trim())
}

/** One-time code, shown once. Only its SHA-256 is stored, so the database never holds a usable code. */
export async function createPairingCode(db: Db, wallet: Address): Promise<{ code: string; expiresAt: string }> {
  const bytes = randomBytes(12)
  const body = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  const code = `ARC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`
  const expiresAt = isoIn(PAIRING_TTL_MS)

  await db.run('delete from pairing_codes where wallet = ? and (used_at is null or expires_at < ?)', [wallet, nowIso()])
  await db.run('insert into pairing_codes (code_hash, wallet, expires_at) values (?, ?, ?)', [sha256(body), wallet, expiresAt])
  return { code, expiresAt }
}

export async function redeemPairingCode(
  db: Db,
  rawCode: string,
  telegramId: number,
  telegramUsername: string | null,
): Promise<{ wallet: Address; username: string | null } | null> {
  const body = normalizeCode(rawCode)
  if (!body) return null

  return db.transaction(async (tx) => {
    const now = nowIso()
    const rows = await tx.all<{ wallet: string }>(
      'update pairing_codes set used_at = ? where code_hash = ? and used_at is null and expires_at > ? returning wallet',
      [now, sha256(body), now],
    )
    const wallet = rows[0]?.wallet
    if (!wallet) return null

    await tx.run('delete from telegram_links where telegram_id = ? or wallet = ?', [telegramId, wallet])
    await tx.run('insert into telegram_links (telegram_id, wallet, telegram_username) values (?, ?, ?)', [
      telegramId,
      wallet,
      telegramUsername,
    ])
    const user = await tx.get<{ username: string | null }>('select username from users where wallet = ?', [wallet])
    return { wallet: wallet as Address, username: user?.username ?? null }
  })
}

// ---------- recipient resolution ----------

export interface Recipient {
  wallet: Address
  label: string
  via: 'address' | 'onchain' | 'telegram'
}

/**
 * Resolve "@name", "name" or "0x..." to a wallet. On-chain usernames are authoritative and checked on-chain;
 * Telegram handles resolve through wallets that were linked with a pairing code.
 */
export async function resolveRecipient(db: Db, raw: string): Promise<Recipient> {
  const input = raw.trim().replace(/^@/, '')
  if (!input) throw new AppError('missing_recipient', 'Tell me who to pay, for example @alice.')

  if (/^0x/i.test(input)) {
    const wallet = normalizeAddress(input)
    if (!wallet) throw new AppError('invalid_address', 'That does not look like a valid wallet address.')
    return { wallet, label: shortAddress(wallet), via: 'address' }
  }

  const name = input.toLowerCase()
  if (!/^[a-z0-9_]{3,32}$/.test(name)) {
    throw new AppError('invalid_name', `"${input}" is not a valid username. Use 3 to 32 letters, numbers or underscores.`)
  }

  let onchain: Address | null
  try {
    onchain = await resolveOnchainName(name)
  } catch {
    throw new AppError('rpc_error', 'Could not reach the Arc network to look that name up. Try again shortly.', 502)
  }
  if (onchain) return { wallet: onchain, label: `@${name}`, via: 'onchain' }

  const linked = await db.get<{ wallet: string }>('select wallet from telegram_links where lower(telegram_username) = ?', [name])
  if (linked) return { wallet: linked.wallet as Address, label: `@${name} (Telegram)`, via: 'telegram' }

  throw new AppError(
    'unregistered',
    `@${name} is not registered. They need to register a username on the ArcPay dashboard or link their Telegram.`,
    404,
  )
}

// ---------- payment intents ----------

export interface Intent {
  id: string
  senderWallet: Address
  recipientWallet: Address
  recipientLabel: string
  amount: string
  kind: string
  source: string
  status: string
  txHash: string | null
  createdAt: string
  expiresAt: string
}

interface IntentRow {
  id: string
  sender_wallet: string
  recipient_wallet: string
  recipient_label: string
  amount: string
  kind: string
  source: string
  status: string
  tx_hash: string | null
  created_at: string
  expires_at: string
}

function toIntent(row: IntentRow): Intent {
  const expired = row.status === 'pending' && row.expires_at < nowIso()
  return {
    id: row.id,
    senderWallet: row.sender_wallet as Address,
    recipientWallet: row.recipient_wallet as Address,
    recipientLabel: row.recipient_label,
    amount: String(row.amount),
    kind: row.kind,
    source: row.source,
    status: expired ? 'expired' : row.status,
    txHash: row.tx_hash ?? null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

export async function createIntent(
  db: Db,
  input: {
    sender: Address
    recipient: Recipient
    amount: bigint
    kind: 'send' | 'tip'
    source: 'telegram' | 'web'
    telegramId?: number
  },
): Promise<Intent> {
  if (input.amount <= 0n) throw new AppError('invalid_amount', 'Enter an amount greater than zero.')
  if (input.recipient.wallet === input.sender) {
    throw new AppError('self_payment', 'You cannot send USDC to yourself.')
  }

  let balance: bigint
  try {
    balance = await usdcBalance(input.sender)
  } catch {
    throw new AppError('rpc_error', 'Could not read your balance from the Arc network. Try again shortly.', 502)
  }
  if (balance < input.amount) {
    throw new AppError(
      'insufficient_funds',
      `Insufficient USDC. You have ${formatUsdc(balance)} USDC but need ${formatUsdc(input.amount)}.`,
    )
  }
  if (balance - input.amount < GAS_RESERVE) {
    throw new AppError(
      'insufficient_gas',
      `That would leave too little USDC for network fees (gas is paid in USDC on Arc). Keep at least ${formatUsdc(GAS_RESERVE)} USDC spare.`,
    )
  }

  const id = randomBytes(16).toString('hex')
  const rows = await db.all<IntentRow>(
    `insert into payment_intents
      (id, sender_wallet, recipient_wallet, recipient_label, amount, kind, source, telegram_id, created_at, expires_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    [
      id,
      input.sender,
      input.recipient.wallet,
      input.recipient.label,
      input.amount.toString(),
      input.kind,
      input.source,
      input.telegramId ?? null,
      nowIso(),
      isoIn(INTENT_TTL_MS),
    ],
  )
  return toIntent(rows[0])
}

export async function getIntent(db: Db, id: string): Promise<Intent | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null
  const row = await db.get<IntentRow>('select * from payment_intents where id = ?', [id])
  return row ? toIntent(row) : null
}

export async function cancelIntent(db: Db, id: string, sender: string): Promise<boolean> {
  const changed = await db.run(
    "update payment_intents set status = 'cancelled' where id = ? and sender_wallet = ? and status = 'pending'",
    [id, sender],
  )
  return changed > 0
}

export async function listIntents(db: Db, wallet: string, limit = 20): Promise<Intent[]> {
  const rows = await db.all<IntentRow>(
    'select * from payment_intents where sender_wallet = ? order by created_at desc limit ?',
    [wallet, limit],
  )
  return rows.map(toIntent)
}

// ---------- payments ----------

export interface PaymentRow {
  txHash: string
  logIndex: number
  from: string
  to: string
  amount: string
  memo: string
  blockNumber: string
  blockTime: string
  direction: 'sent' | 'received'
  counterpartyName: string | null
}

interface PaymentDbRow {
  tx_hash: string
  log_index: number
  from_wallet: string
  to_wallet: string
  amount: string
  memo: string
  block_number: number
  block_time: string
  counterparty_name: string | null
}

export async function listPayments(db: Db, wallet: string, limit = 50): Promise<PaymentRow[]> {
  const rows = await db.all<PaymentDbRow>(
    `select p.tx_hash, p.log_index, p.from_wallet, p.to_wallet, p.amount, p.memo,
       p.block_number, p.block_time, u.username as counterparty_name
     from payments p
     left join users u on u.wallet = case when p.from_wallet = ? then p.to_wallet else p.from_wallet end
     where p.from_wallet = ? or p.to_wallet = ?
     order by p.block_number desc, p.log_index desc limit ?`,
    [wallet, wallet, wallet, limit],
  )
  return rows.map((r) => ({
    txHash: r.tx_hash,
    logIndex: Number(r.log_index),
    from: r.from_wallet,
    to: r.to_wallet,
    amount: r.amount,
    memo: r.memo,
    blockNumber: String(r.block_number),
    blockTime: r.block_time,
    direction: r.from_wallet === wallet ? 'sent' : 'received',
    counterpartyName: r.counterparty_name ?? null,
  }))
}
