import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Send as SendIcon, ShieldCheck, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, type Me } from '@/lib/api'
import { useAuthedApi, useHealth } from '@/lib/queries'
import { SpendingLimitCard } from './SpendingLimitCard'
import { CopyButton, Card, Notice, SectionTitle, Spinner } from './ui'

interface Pairing {
  code: string
  expiresAt: string
}

function useCountdown(expiresAt: string | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  return expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0
}

function PairingCard({ me }: { me: Me }) {
  const call = useAuthedApi()
  const queryClient = useQueryClient()
  const health = useHealth()
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<{ botUsername: string | null }>('/config'), refetchInterval: 15_000 })
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secondsLeft = useCountdown(pairing?.expiresAt)
  const wasLinked = useRef(Boolean(me.telegram))

  // Announce the moment the bot redeems the code (the dashboard already polls /me).
  useEffect(() => {
    if (me.telegram && !wasLinked.current) {
      toast.success('Telegram linked. Open the bot and try /balance.')
      setPairing(null)
    }
    wasLinked.current = Boolean(me.telegram)
  }, [me.telegram])

  const botUsername = config.data?.botUsername ?? health.data?.bot.username ?? null
  const botConfigured = health.data?.bot.configured ?? false

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      setPairing(await call<Pairing>('/pairing', { method: 'POST' }))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create a code. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      await call('/telegram', { method: 'DELETE' })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.success('Telegram disconnected.')
    } finally {
      setBusy(false)
    }
  }

  if (me.telegram) {
    return (
      <Card active>
        <SectionTitle hint="The bot can prepare payments for this wallet. You still sign each one yourself.">Telegram connected</SectionTitle>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold">{me.telegram.telegramUsername ? `@${me.telegram.telegramUsername}` : 'Telegram account'}</div>
            <div className="text-sm text-white/60">Linked {new Date(me.telegram.linkedAt).toLocaleDateString()}</div>
            {!me.telegram.telegramUsername ? (
              <p className="mt-2 text-sm text-sunset-yellow">Set a Telegram username so people can pay @you in chats.</p>
            ) : null}
          </div>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void unlink()}>
            <Unlink className="h-4 w-4" /> Disconnect
          </button>
        </div>
      </Card>
    )
  }

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, '0')

  return (
    <Card active>
      <SectionTitle hint="Link your Telegram account to send and receive USDC in chat.">Pair Telegram</SectionTitle>

      {!botConfigured && health.data ? (
        <div className="mb-4">
          <Notice tone="warn">
            The Telegram bot is not switched on yet, so a code cannot be redeemed. The admin needs to add TELEGRAM_BOT_TOKEN in .env and
            restart the backend.
          </Notice>
        </div>
      ) : null}

      {pairing && secondsLeft > 0 ? (
        <div className="space-y-4">
          <div>
            <div className="label">Your one-time code</div>
            <div className="mt-1.5 break-all rounded-xl border-2 border-dashed border-white/30 bg-black/50 px-4 py-4 text-center font-mono text-2xl font-bold tracking-widest sm:text-3xl">
              {pairing.code}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-white/60">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" /> Single use. Expires in {minutes}:{seconds}
              </span>
              <CopyButton value={pairing.code} label="Copy code" />
            </div>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-white/75">
            <li>Copy the code.</li>
            <li>
              Open{' '}
              {botUsername ? (
                <a className="font-bold underline" href={`https://t.me/${botUsername}`} target="_blank" rel="noopener noreferrer">
                  @{botUsername} <ExternalLink className="inline h-3 w-3" />
                </a>
              ) : (
                'the ArcPay bot'
              )}{' '}
              in a private chat.
            </li>
            <li>Paste the code and send it. You will get a confirmation message.</li>
          </ol>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-pretty text-sm text-white/70">
            You will get a code that works once and expires in 10 minutes. We only store a hash of it, so even the database cannot reveal it.
          </p>
          {pairing && secondsLeft === 0 ? <Notice tone="warn">That code expired. Generate a new one.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <button type="button" className="btn-sunset w-full sm:w-auto" disabled={busy} onClick={() => void generate()}>
            {busy ? <Spinner /> : null}
            Generate pairing code
          </button>
        </div>
      )}
    </Card>
  )
}

const COMMANDS = [
  ['send 5 to @alice', 'Prepare a payment. You sign it in your wallet.'],
  ['/tip @alice 1', 'Quick tip. Reply to a message with /tip 1 in groups.'],
  ['/receive', 'Show your username and wallet to get paid.'],
  ['/balance  /history', 'Check your USDC and recent payments.'],
]

export function OverviewTab({ me, onSend }: { me: Me; onSend: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PairingCard me={me} />
      <div className="space-y-5">
        <SpendingLimitCard />
        <Card>
          <SectionTitle hint="Works in a private chat with the bot.">Bot commands</SectionTitle>
          <ul className="space-y-3">
            {COMMANDS.map(([command, text]) => (
              <li key={command}>
                <code className="rounded-md bg-white/10 px-2 py-1 text-sm font-bold">{command}</code>
                <p className="mt-1 text-sm text-white/65">{text}</p>
              </li>
            ))}
          </ul>
        </Card>
        <button type="button" className="btn-sunset w-full" onClick={onSend}>
          <SendIcon className="h-4 w-4" /> Send a payment
        </button>
      </div>
    </div>
  )
}
