import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import type { PaymentItem } from '@/lib/api'
import { buildTxLink, shortAddress } from '@/lib/env'
import { usePayments } from '@/lib/queries'
import { Card, Notice, SectionTitle, Spinner } from './ui'

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Row({ payment }: { payment: PaymentItem }) {
  const sent = payment.direction === 'sent'
  const counterparty = payment.counterpartyName ? `@${payment.counterpartyName}` : shortAddress(sent ? payment.to : payment.from)
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${
          sent ? 'border-sunset-orange/70 text-sunset-orange' : 'border-emerald-400/70 text-emerald-300'
        }`}
      >
        {sent ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">
          {sent ? 'Sent to' : 'Received from'} {counterparty}
        </div>
        <div className="text-xs text-white/55">{dateFormat.format(new Date(payment.blockTime))}</div>
      </div>
      <div className="text-right">
        <div className={`font-bold tabular-nums ${sent ? 'text-white' : 'text-emerald-300'}`}>
          {sent ? '-' : '+'}
          {formatUsdc(BigInt(payment.amount))}
        </div>
        <a
          className="inline-flex items-center gap-1 text-xs text-white/50 underline"
          href={buildTxLink(payment.txHash)}
          target="_blank"
          rel="noopener noreferrer"
        >
          tx <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </li>
  )
}

export function HistoryTab() {
  const { data, isLoading, error } = usePayments()
  const behind = data ? BigInt(data.indexer.behind ?? '0') : 0n

  return (
    <Card active>
      <SectionTitle hint="Every USDC payment through ArcPay, read from the chain. Updates live.">History</SectionTitle>

      {data ? (
        <p className="mb-3 text-xs text-white/50">
          {data.indexer.running
            ? behind > 2n
              ? `Catching up: ${behind.toString()} blocks behind the chain.`
              : `Live. Synced to block ${data.indexer.nextBlock ?? '...'}.`
            : 'The payment indexer is not running.'}
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/70">
          <Spinner /> Loading payments
        </div>
      ) : error ? (
        <Notice tone="error">Could not load your history. {error.message}</Notice>
      ) : data && data.payments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/20 px-4 py-8 text-center text-sm text-white/60">
          No payments yet. Send your first one from the Send tab.
        </div>
      ) : (
        <ul className="divide-y divide-white/10">
          {data?.payments.map((payment) => <Row key={`${payment.txHash}-${payment.logIndex}`} payment={payment} />)}
        </ul>
      )}
    </Card>
  )
}
