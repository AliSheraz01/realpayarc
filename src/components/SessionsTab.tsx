import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Laptop, LogOut, Send as TelegramIcon, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthedApi, useSessions } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { Card, Notice, SectionTitle, Spinner } from './ui'

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SessionsTab() {
  const call = useAuthedApi()
  const { signOut } = useSession()
  const queryClient = useQueryClient()
  const { data, isLoading } = useSessions()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  async function run(key: string, task: () => Promise<void>, message: string) {
    setBusy(key)
    try {
      await task()
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      toast.success(message)
    } catch {
      toast.error('That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const others = (data?.web ?? []).filter((s) => !s.current)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card active>
        <SectionTitle hint="Browsers and devices signed in with this wallet.">Web sessions</SectionTitle>
        {isLoading ? (
          <Spinner />
        ) : (
          <ul className="space-y-2.5">
            {data?.web.map((session) => (
              <li key={session.id} className="flex items-center gap-3 rounded-xl border border-white/15 p-3">
                <Laptop className="h-5 w-5 shrink-0 text-white/60" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-bold">
                    {session.current ? 'This device' : 'Other device'}
                    {session.current ? <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">current</span> : null}
                  </div>
                  <div className="text-xs text-white/55">Last active {dateFormat.format(new Date(session.lastSeenAt))}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy !== null || others.length === 0}
            onClick={() => void run('others', () => call('/sessions/revoke-others', { method: 'POST' }), 'Other sessions signed out.')}
          >
            Sign out other devices
          </button>
          <button type="button" className="btn-ghost" onClick={() => void signOut(true)}>
            <LogOut className="h-4 w-4" /> Disconnect wallet
          </button>
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <SectionTitle hint="The Telegram account allowed to prepare payments for this wallet.">Telegram bot session</SectionTitle>
          {data?.telegram ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <TelegramIcon className="h-5 w-5 text-white/60" />
                <div className="text-sm">
                  <div className="font-bold">{data.telegram.telegramUsername ? `@${data.telegram.telegramUsername}` : 'Telegram account'}</div>
                  <div className="text-xs text-white/55">Linked {dateFormat.format(new Date(data.telegram.linkedAt))}</div>
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy !== null}
                onClick={() => void run('telegram', () => call('/telegram', { method: 'DELETE' }), 'Telegram session revoked.')}
              >
                Revoke bot access
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/60">No Telegram account is linked.</p>
          )}
          <p className="mt-3 text-xs text-white/50">
            Revoking the bot stops it sending for you. If you turned on a spending limit, also turn it off on the Overview tab; that needs your wallet because it is an onchain setting.
          </p>
        </Card>

        <Card>
          <SectionTitle hint="Use this if a device or your Telegram account is lost or compromised.">Emergency</SectionTitle>
          {confirmAll ? (
            <div className="space-y-3">
              <Notice tone="warn">
                This signs out every device, unlinks Telegram, and disconnects this wallet. Your username and funds are not affected.
              </Notice>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  className="btn-sunset"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      'all',
                      async () => {
                        await call('/sessions/revoke-all', { method: 'POST' })
                        await signOut(true)
                      },
                      'Everything revoked.',
                    )
                  }
                >
                  Revoke everything
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setConfirmAll(true)}>
              <ShieldAlert className="h-4 w-4" /> Revoke all sessions
            </button>
          )}
        </Card>
      </div>
    </div>
  )
}
