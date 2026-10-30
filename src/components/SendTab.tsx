import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AtSign } from 'lucide-react'
import { formatUsdc } from '@/onchain-money'
import { ApiError, type Intent } from '@/lib/api'
import { GAS_RESERVE, useUsdcBalance, type PayStep } from '@/lib/hooks'
import { useAuthedApi, useIntents } from '@/lib/queries'
import { GuidedSteps, type GuideStep } from './GuidedSteps'
import { IntentPayer } from './IntentPayer'
import { Card, Notice, SectionTitle, Spinner } from './ui'

const GUIDE: GuideStep[] = [
  { title: 'Choose who gets paid', body: 'Type a @username (an ArcPay name or a linked Telegram handle) or paste a 0x wallet address.' },
  { title: 'Enter the amount', body: 'Amounts are in USDC. Keep a little spare for the network fee, which is also paid in USDC on Arc.' },
  { title: 'Review the recipient', body: 'We look the name up and show the exact wallet. Check it before you sign.' },
  { title: 'Approve USDC', body: 'Your wallet asks once to let ArcPay move exactly this amount. Skipped if already approved.' },
  { title: 'Confirm the payment', body: 'Sign the payment in your wallet. USDC goes straight from you to them.' },
  { title: 'Done', body: 'The payment is final onchain and shows up in your history.' },
]

export function SendTab() {
  const call = useAuthedApi()
  const queryClient = useQueryClient()
  const balance = useUsdcBalance()
  const intents = useIntents()

  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [via, setVia] = useState<string | null>(null)
  const [payStep, setPayStep] = useState<PayStep>('idle')
  const [openId, setOpenId] = useState<string | null>(null)

  const maxSpendable = balance.data !== undefined && balance.data > GAS_RESERVE ? balance.data - GAS_RESERVE : 0n
  const amountValid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0

  let current = 0
  if (to.trim()) current = 1
  if (to.trim() && amountValid) current = 2
  if (intent) current = payStep === 'idle' ? 2 : payStep === 'approving' ? 3 : payStep === 'paying' ? 4 : payStep === 'confirming' ? 4 : 5

  async function review() {
    setError(null)
    setCreating(true)
    try {
      const result = await call<{ intent: Intent; via: string }>('/intents', { method: 'POST', body: { to: to.trim(), amount } })
      setIntent(result.intent)
      setVia(result.via)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not prepare the payment. Try again.')
    } finally {
      setCreating(false)
    }
  }

  async function reset(cancel: boolean) {
    if (cancel && intent && payStep === 'idle') await call(`/intents/${intent.id}/cancel`, { method: 'POST' }).catch(() => undefined)
    setIntent(null)
    setVia(null)
    setPayStep('idle')
    if (payStep === 'done') {
      setTo('')
      setAmount('')
    }
    await queryClient.invalidateQueries({ queryKey: ['intents'] })
  }

  const pending = (intents.data?.intents ?? []).filter((item) => item.status === 'pending' && item.source === 'telegram')

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Card active>
          <SectionTitle hint="Pay anyone by @username or wallet address. You sign every payment yourself.">Send payment</SectionTitle>

          {intent ? (
            <div className="space-y-4">
              {via === 'telegram' ? (
                <Notice tone="warn">Resolved through a linked Telegram handle. Double check the wallet below before signing.</Notice>
              ) : null}
              <IntentPayer intent={intent} onStep={setPayStep} onDone={() => undefined} />
              {payStep === 'idle' || payStep === 'done' ? (
                <button type="button" className="btn-ghost w-full" onClick={() => void reset(true)}>
                  {payStep === 'done' ? 'Send another' : 'Change details'}
                </button>
              ) : null}
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void review()
              }}
            >
              <div>
                <label className="label" htmlFor="recipient">
                  Recipient
                </label>
                <div className="relative mt-1.5">
                  <AtSign className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                  <input
                    id="recipient"
                    className="field pl-10"
                    placeholder="username or 0x wallet"
                    value={to}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setTo(event.target.value.trim())}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between">
                  <label className="label" htmlFor="amount">
                    Amount (USDC)
                  </label>
                  <span className="text-xs tabular-nums text-white/55">
                    Balance {balance.data !== undefined ? formatUsdc(balance.data) : '...'}
                  </span>
                </div>
                <div className="relative mt-1.5">
                  <input
                    id="amount"
                    className="field pr-20 text-xl font-bold tabular-nums"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(',', '.').trim())}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-white/25 px-2.5 py-1 text-xs font-bold uppercase tracking-wider hover:bg-white/10"
                    onClick={() => setAmount(formatUsdc(maxSpendable))}
                    disabled={maxSpendable === 0n}
                  >
                    Max
                  </button>
                </div>
                {amount && !amountValid ? <p className="mt-1.5 text-sm text-red-300">Enter a positive amount with up to 6 decimals.</p> : null}
              </div>

              {error ? <Notice tone="error">{error}</Notice> : null}

              <button type="submit" className="btn-sunset w-full" disabled={creating || !to || !amountValid}>
                {creating ? <Spinner /> : null}
                {creating ? 'Looking up recipient' : 'Review payment'}
              </button>
            </form>
          )}
        </Card>

        {pending.length > 0 ? (
          <Card>
            <SectionTitle hint="Created in Telegram, waiting for your signature.">Pending requests</SectionTitle>
            <ul className="space-y-3">
              {pending.map((item) => (
                <li key={item.id} className="rounded-xl border border-white/15 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold tabular-nums">{formatUsdc(BigInt(item.amount))} USDC</div>
                      <div className="text-sm text-white/65">to {item.recipientLabel}</div>
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => setOpenId(openId === item.id ? null : item.id)}>
                      {openId === item.id ? 'Hide' : 'Review'}
                    </button>
                  </div>
                  {openId === item.id ? (
                    <div className="mt-3">
                      <IntentPayer intent={item} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit">
        <SectionTitle hint="This walkthrough follows you as you pay.">How sending works</SectionTitle>
        <GuidedSteps steps={GUIDE} current={current} finished={payStep === 'done'} />
      </Card>
    </div>
  )
}
