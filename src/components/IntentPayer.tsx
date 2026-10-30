import { useEffect } from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import type { Intent } from '@/lib/api'
import { buildTxLink, shortAddress } from '@/lib/env'
import { usePayIntent, type PayStep } from '@/lib/hooks'
import { Notice, Spinner } from './ui'

const STEP_COPY: Record<PayStep, string> = {
  idle: 'Review and sign',
  approving: 'Approve USDC in your wallet',
  paying: 'Confirm the payment in your wallet',
  confirming: 'Waiting for the network',
  done: 'Payment sent',
}

/** Shows a resolved payment request and runs the approve + pay flow for it. */
export function IntentPayer({
  intent,
  onDone,
  onStep,
}: {
  intent: Intent
  onDone?: () => void
  onStep?: (step: PayStep) => void
}) {
  const { pay, step, error, txHash } = usePayIntent()
  useEffect(() => {
    onStep?.(step)
  }, [step, onStep])
  const busy = step === 'approving' || step === 'paying' || step === 'confirming'
  const alreadyDone = intent.status === 'confirmed'
  const closed = intent.status === 'cancelled' || intent.status === 'expired' || intent.status === 'failed'

  const txForLink = txHash ?? intent.txHash

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/15 bg-black/40 p-4">
        <div className="label">You are sending</div>
        <div className="mt-1 font-display text-4xl tabular-nums sm:text-5xl">
          <span className="heading-outline">{formatUsdc(BigInt(intent.amount))}</span>
          <span className="ml-2 text-lg text-white/70">USDC</span>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-white/55">To</dt>
          <dd className="font-bold">{intent.recipientLabel}</dd>
          <dt className="text-white/55">Wallet</dt>
          <dd className="font-mono text-xs leading-6 text-white/80 [overflow-wrap:anywhere]">{intent.recipientWallet}</dd>
          <dt className="text-white/55">Network</dt>
          <dd>Arc</dd>
        </dl>
      </div>

      {alreadyDone || step === 'done' ? (
        <Notice tone="ok">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Sent to {shortAddress(intent.recipientWallet)}. It will appear in your history.
          </span>
        </Notice>
      ) : closed ? (
        <Notice tone="warn">This request is {intent.status}. Ask for a new one in Telegram or create it on the Send tab.</Notice>
      ) : (
        <button
          type="button"
          className="btn-sunset w-full"
          disabled={busy}
          onClick={() => {
            void pay(intent).then((ok) => {
              if (ok) onDone?.()
            })
          }}
        >
          {busy ? <Spinner /> : null}
          {STEP_COPY[step]}
        </button>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {txForLink ? (
        <a
          className="flex items-center justify-center gap-1.5 text-xs text-white/60 underline"
          href={buildTxLink(txForLink)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View transaction <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  )
}
