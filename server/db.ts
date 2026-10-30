import { createClient, type Client, type InValue, type Transaction } from '@libsql/client'

/**
 * Turso (libSQL) storage layer. The admin supplies TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
 * (run `bun run setup`); until they are set the API reports `db_not_configured`.
 *
 * Conventions: timestamps are ISO-8601 UTC strings (they sort correctly as text) and USDC amounts
 * are base-unit integers stored as TEXT, so they never lose precision.
 */

const NOW_DEFAULT = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"

const SCHEMA = `
create table if not exists users (
  wallet text primary key,
  username text unique,
  created_at text not null default ${NOW_DEFAULT}
);

create table if not exists telegram_links (
  telegram_id integer primary key,
  wallet text not null unique references users(wallet) on delete cascade,
  telegram_username text,
  linked_at text not null default ${NOW_DEFAULT}
);
create index if not exists telegram_links_username_idx on telegram_links (lower(telegram_username));

create table if not exists web_sessions (
  token_hash text primary key,
  wallet text not null references users(wallet) on delete cascade,
  created_at text not null default ${NOW_DEFAULT},
  last_seen_at text not null default ${NOW_DEFAULT},
  expires_at text not null
);

create table if not exists auth_nonces (
  nonce text primary key,
  wallet text not null,
  message text not null,
  expires_at text not null
);

create table if not exists pairing_codes (
  code_hash text primary key,
  wallet text not null references users(wallet) on delete cascade,
  expires_at text not null,
  used_at text
);

create table if not exists payment_intents (
  id text primary key,
  sender_wallet text not null,
  recipient_wallet text not null,
  recipient_label text not null,
  amount text not null,
  kind text not null default 'send',
  source text not null,
  telegram_id integer,
  status text not null default 'pending',
  tx_hash text,
  created_at text not null default ${NOW_DEFAULT},
  expires_at text not null
);
create index if not exists payment_intents_sender_idx on payment_intents (sender_wallet, created_at desc);

create table if not exists payments (
  tx_hash text not null,
  log_index integer not null,
  from_wallet text not null,
  to_wallet text not null,
  amount text not null,
  memo text not null,
  block_number integer not null,
  block_time text not null,
  primary key (tx_hash, log_index)
);
create index if not exists payments_from_idx on payments (from_wallet, block_number desc);
create index if not exists payments_to_idx on payments (to_wallet, block_number desc);

create table if not exists kv (
  key text primary key,
  value text not null
);

create table if not exists tg_state (
  telegram_id integer primary key,
  state text not null,
  updated_at text not null default ${NOW_DEFAULT}
);
`

export const nowIso = (): string => new Date().toISOString()
export const isoIn = (ms: number): string => new Date(Date.now() + ms).toISOString()

/** Thin wrapper over the libSQL client: positional `?` parameters, plain-object rows. */
export class Db {
  constructor(
    private readonly executor: Client | Transaction,
    private readonly client?: Client,
  ) {}

  /** Remote connections can go stale between requests. Retry once on a dropped socket (not inside a transaction). */
  private async execute(sql: string, args: InValue[]) {
    try {
      return await this.executor.execute({ sql, args })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const dropped = /socket connection was closed|ECONNRESET|fetch failed|network/i.test(message)
      if (!dropped || this.executor !== this.client) throw error
      return this.executor.execute({ sql, args })
    }
  }

  /** Run a query and return all rows as objects keyed by column name. */
  async all<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T[]> {
    const result = await this.execute(sql, args)
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
    ) as T[]
  }

  async get<T = Record<string, unknown>>(sql: string, args: InValue[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, args))[0]
  }

  /** Run a statement and return how many rows it changed. */
  async run(sql: string, args: InValue[] = []): Promise<number> {
    const result = await this.execute(sql, args)
    return result.rowsAffected
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (!this.client) throw new Error('Nested transactions are not supported')
    const tx = await this.client.transaction('write')
    try {
      const result = await fn(new Db(tx))
      await tx.commit()
      return result
    } catch (error) {
      await tx.rollback()
      throw error
    } finally {
      tx.close()
    }
  }

  async migrate(): Promise<void> {
    if (!this.client) throw new Error('migrate must run on the root connection')
    await this.client.executeMultiple(SCHEMA)
  }

  close(): void {
    this.client?.close()
  }
}

export function connectDb(url: string, authToken?: string): Db {
  const remote = /^(libsql|https?|wss?):\/\//.test(url)
  if (remote && !authToken) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote Turso database')
  }
  const client = createClient({ url, authToken: remote ? authToken : undefined })
  return new Db(client, client)
}

export async function initSchema(db: Db): Promise<void> {
  await db.migrate()
  // Fail fast with a clear message if the credentials are wrong.
  await db.get('select 1 as ok')
}

export async function getKv(db: Db, key: string): Promise<string | undefined> {
  return (await db.get<{ value: string }>('select value from kv where key = ?', [key]))?.value
}

export async function setKv(db: Db, key: string, value: string): Promise<void> {
  await db.run('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value', [
    key,
    value,
  ])
}
