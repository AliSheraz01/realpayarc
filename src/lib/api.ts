export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  token?: string | null
}

/** Calls the backend through the dev proxy (`/api/*`). Throws ApiError with a user-safe message. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError('offline', 'Cannot reach the ArcPay backend. Is it running?', 0)
  }

  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const body = data as { error?: string; message?: string } | null
    throw new ApiError(body?.error ?? 'error', body?.message ?? `Request failed (${response.status})`, response.status)
  }
  return data as T
}

export interface Health {
  ok: boolean
  database: { configured: boolean; ready: boolean; error: string | null }
  chain: { id: number; name: string; mainnet: boolean }
  contract: string | null
  bot: { configured: boolean; running: boolean; username: string | null; error: string | null }
  indexer: { running: boolean; nextBlock: string | null; head: string | null; behind: string | null; lastError: string | null }
  relayer?: { address: string; balance: string; low: boolean } | null
}

export interface TelegramLinkInfo {
  telegramId: number
  telegramUsername: string | null
  linkedAt: string
}

export interface Me {
  wallet: string
  username: string | null
  telegram: TelegramLinkInfo | null
}

export interface PaymentItem {
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

export interface Intent {
  id: string
  senderWallet: string
  recipientWallet: string
  recipientLabel: string
  amount: string
  kind: string
  source: string
  status: string
  txHash: string | null
  createdAt: string
  expiresAt: string
}

export interface SessionItem {
  id: string
  current: boolean
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}
