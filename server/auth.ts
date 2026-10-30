import { createHash, randomBytes } from 'node:crypto'
import { getAddress, type Address } from 'viem'
import { publicClient, normalizeAddress } from './chain'
import { isoIn, nowIso, type Db } from './db'
import { env, SESSION_TTL_MS } from './env'
import { AppError } from './errors'

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export interface AuthContext {
  wallet: Address
  tokenHash: string
}

/** Step 1 of wallet sign-in: issue a single-use, short-lived message for the wallet to sign. */
export async function createNonce(db: Db, walletInput: string): Promise<{ nonce: string; message: string }> {
  const wallet = normalizeAddress(walletInput)
  if (!wallet) throw new AppError('invalid_address', 'That is not a valid wallet address.')

  const nonce = randomBytes(16).toString('hex')
  const message = [
    'ArcPay sign-in',
    '',
    'Sign this message to prove you own this wallet. It costs no gas and moves no funds.',
    '',
    `Wallet: ${getAddress(wallet)}`,
    `Chain ID: ${env.chainId}`,
    `Nonce: ${nonce}`,
    `Issued: ${nowIso()}`,
  ].join('\n')

  await db.run('delete from auth_nonces where expires_at < ?', [nowIso()])
  await db.run('insert into auth_nonces (nonce, wallet, message, expires_at) values (?, ?, ?, ?)', [
    nonce,
    wallet,
    message,
    isoIn(5 * 60_000),
  ])
  return { nonce, message }
}

/** Step 2: verify the signature (EOA, ERC-1271 and ERC-6492 wallets) and open a web session. */
export async function verifySignIn(
  db: Db,
  input: { address: string; nonce: string; signature: string },
): Promise<{ token: string; wallet: Address; expiresAt: string }> {
  const wallet = normalizeAddress(input.address)
  if (!wallet) throw new AppError('invalid_address', 'That is not a valid wallet address.')

  const rows = await db.all<{ message: string }>(
    'delete from auth_nonces where nonce = ? and wallet = ? and expires_at > ? returning message',
    [input.nonce, wallet, nowIso()],
  )
  const message = rows[0]?.message
  if (!message) throw new AppError('nonce_expired', 'Sign-in request expired. Try connecting again.', 401)

  let valid = false
  try {
    valid = await publicClient.verifyMessage({
      address: wallet,
      message,
      signature: input.signature as `0x${string}`,
    })
  } catch {
    valid = false
  }
  if (!valid) throw new AppError('bad_signature', 'Signature did not match this wallet.', 401)

  await db.run('insert into users (wallet) values (?) on conflict (wallet) do nothing', [wallet])

  const token = randomBytes(32).toString('hex')
  const expiresAt = isoIn(SESSION_TTL_MS)
  await db.run('insert into web_sessions (token_hash, wallet, expires_at) values (?, ?, ?)', [sha256(token), wallet, expiresAt])
  return { token, wallet, expiresAt }
}

export async function authenticate(db: Db, request: Request): Promise<AuthContext> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new AppError('unauthorized', 'Connect your wallet and sign in first.', 401)

  const tokenHash = sha256(token)
  const rows = await db.all<{ wallet: string }>(
    'update web_sessions set last_seen_at = ? where token_hash = ? and expires_at > ? returning wallet',
    [nowIso(), tokenHash, nowIso()],
  )
  const wallet = rows[0]?.wallet
  if (!wallet) throw new AppError('unauthorized', 'Your session has ended. Sign in again.', 401)
  return { wallet: wallet as Address, tokenHash }
}
