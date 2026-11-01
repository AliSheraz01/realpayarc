import { parseAbi, parseEventLogs, type Address, type Log } from 'viem'
import { formatUsdc } from '../src/onchain-money'
import { intentIdFromMemo, publicClient, requireContract, shortAddress } from './chain'
import { getKv, setKv, type Db } from './db'
import { env } from './env'
import { notifyTelegram } from './notify'
import { getLinkByWallet } from './services'

const indexedEvents = parseAbi([
  'event UsernameRegistered(address indexed owner, bytes32 indexed nameHash, string name)',
  'event Payment(address indexed from, address indexed to, uint256 amount, bytes32 memo)',
  'event DelegatedPayment(address indexed from, address indexed to, address indexed relayer, uint256 amount, uint256 fee, bytes32 memo)',
])

const BATCH = 2000n
const LOOKBACK = 5000n
const NOTIFY_WINDOW_MS = 15 * 60 * 1000

export const indexerStatus = {
  running: false,
  nextBlock: null as string | null,
  head: null as string | null,
  behind: null as string | null,
  startedFrom: null as string | null,
  lastError: null as string | null,
}

type IndexedLog = Log<bigint, number, false, undefined, true, typeof indexedEvents>

const blockTimes = new Map<bigint, Date>()
async function blockTime(blockNumber: bigint): Promise<Date> {
  const cached = blockTimes.get(blockNumber)
  if (cached) return cached
  const block = await publicClient.getBlock({ blockNumber })
  const time = new Date(Number(block.timestamp) * 1000)
  if (blockTimes.size > 500) blockTimes.clear()
  blockTimes.set(blockNumber, time)
  return time
}

async function ingest(db: Db, logs: IndexedLog[]): Promise<void> {
  for (const log of logs) {
    if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue

    if (log.eventName === 'UsernameRegistered') {
      const wallet = log.args.owner.toLowerCase()
      await db.run(
        'insert into users (wallet, username) values (?, ?) on conflict (wallet) do update set username = excluded.username',
        [wallet, log.args.name],
      )
      continue
    }

    if (log.eventName === 'Payment' || log.eventName === 'DelegatedPayment') {
      const { from, to, amount, memo } = log.args
      const time = await blockTime(log.blockNumber)
      const inserted = await db.all(
        `insert into payments
          (tx_hash, log_index, from_wallet, to_wallet, amount, memo, block_number, block_time)
          values (?, ?, ?, ?, ?, ?, ?, ?)
          on conflict do nothing returning tx_hash`,
        [
          log.transactionHash,
          log.logIndex,
          from.toLowerCase(),
          to.toLowerCase(),
          amount.toString(),
          memo,
          Number(log.blockNumber),
          time.toISOString(),
        ],
      )
      if (inserted.length === 0) continue
      await afterPayment(db, from.toLowerCase(), to.toLowerCase(), amount, memo, log.transactionHash, time, log.eventName === 'DelegatedPayment')
    }
  }
}

async function afterPayment(
  db: Db,
  from: string,
  to: string,
  amount: bigint,
  memo: string,
  txHash: string,
  time: Date,
  delegated: boolean,
): Promise<void> {
  const intentId = intentIdFromMemo(memo)
  const matched = await db.all<{ telegram_id: number | null; recipient_label: string }>(
    `update payment_intents set status = 'confirmed', tx_hash = ?
     where id = ? and sender_wallet = ? and status in ('pending', 'submitted')
     returning telegram_id, recipient_label`,
    [txHash, intentId, from],
  )

  if (Date.now() - time.getTime() > NOTIFY_WINDOW_MS) return

  const senderName = (await db.get<{ username: string | null }>('select username from users where wallet = ?', [from]))
    ?.username
  const fromLabel = senderName ? `@${senderName}` : shortAddress(from)

  const recipientLink = await getLinkByWallet(db, to)
  if (recipientLink) {
    await notifyTelegram(
      recipientLink.telegramId,
      `You received ${formatUsdc(amount)} USDC from ${fromLabel}.\n${env.explorerBase}/tx/${txHash}`,
    )
  }

  // Bot-sent payments were already confirmed in the chat, so skip the duplicate message.
  const telegramId = delegated ? null : matched[0]?.telegram_id
  if (telegramId) {
    await notifyTelegram(
      Number(telegramId),
      `Payment confirmed: ${formatUsdc(amount)} USDC sent to ${matched[0].recipient_label}.\n${env.explorerBase}/tx/${txHash}`,
    )
  }
}

/** Process a specific transaction right away (called after the web app submits a payment). */
export async function ingestTransaction(db: Db, txHash: `0x${string}`): Promise<boolean> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') return false
  const contracts = watchedContracts().map((a) => a.toLowerCase())
  const relevant = receipt.logs.filter((l) => contracts.includes(l.address.toLowerCase()))
  const parsed = parseEventLogs({ abi: indexedEvents, logs: relevant }) as IndexedLog[]
  await ingest(db, parsed)
  return true
}

async function resolveStart(db: Db): Promise<bigint> {
  const stored = await getKv(db, 'indexer_next_block')
  if (stored) return BigInt(stored)

  // Never crawl from genesis: start at the contract's deployment block, else a bounded lookback.
  if (env.deployBlock !== undefined) {
    indexerStatus.startedFrom = `deployment block ${env.deployBlock}`
    return env.deployBlock
  }
  const head = await publicClient.getBlockNumber()
  const start = head > LOOKBACK ? head - LOOKBACK : 0n
  indexerStatus.startedFrom = `head minus ${LOOKBACK} (set ARCPAY_DEPLOY_BLOCK for full history)`
  console.warn(`[indexer] ARCPAY_DEPLOY_BLOCK not set: only indexing the last ${LOOKBACK} blocks`)
  return start
}

function watchedContracts(): Address[] {
  return env.delegate ? [requireContract(), env.delegate] : [requireContract()]
}

export async function runIndexerBatch(db: Db, maxBatches = 5): Promise<void> {
  const contracts = watchedContracts()
  let next = await resolveStart(db)
  const head = await publicClient.getBlockNumber()
  indexerStatus.head = head.toString()

  let batchCount = 0
  while (next <= head && batchCount < maxBatches) {
    const to = next + BATCH - 1n < head ? next + BATCH - 1n : head
    const logs = await publicClient.getLogs({ address: contracts, events: indexedEvents, fromBlock: next, toBlock: to })
    await ingest(db, logs as IndexedLog[])
    next = to + 1n
    await setKv(db, 'indexer_next_block', next.toString())
    batchCount++
  }
  indexerStatus.nextBlock = next.toString()
  indexerStatus.behind = (head >= next ? head - next + 1n : 0n).toString()
}

export async function startIndexer(db: Db): Promise<void> {
  const contracts = watchedContracts()
  let next = await resolveStart(db)
  indexerStatus.running = true
  console.log(`[indexer] starting at block ${next} (${indexerStatus.startedFrom ?? 'resumed'})`)

  for (;;) {
    try {
      const head = await publicClient.getBlockNumber()
      indexerStatus.head = head.toString()
      indexerStatus.nextBlock = next.toString()
      indexerStatus.behind = (head >= next ? head - next + 1n : 0n).toString()

      if (next > head) {
        await new Promise((r) => setTimeout(r, 2500))
        continue
      }

      const to = next + BATCH - 1n < head ? next + BATCH - 1n : head
      const logs = await publicClient.getLogs({ address: contracts, events: indexedEvents, fromBlock: next, toBlock: to })
      await ingest(db, logs as IndexedLog[])
      next = to + 1n
      await setKv(db, 'indexer_next_block', next.toString())
      indexerStatus.lastError = null
      if (to < head) continue
      await new Promise((r) => setTimeout(r, 2500))
    } catch (error) {
      indexerStatus.lastError = error instanceof Error ? error.message : String(error)
      console.warn('[indexer] retrying after error:', indexerStatus.lastError)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
