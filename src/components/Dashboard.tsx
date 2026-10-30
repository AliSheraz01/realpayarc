import { useState } from 'react'
import { ExternalLink, History, LayoutDashboard, Send, ShieldCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { Amount } from '@/onchain-money'
import type { Me } from '@/lib/api'
import { CHAIN, IS_MAINNET, shortAddress, USDC_ADDRESS } from '@/lib/env'
import { useUsdcBalance } from '@/lib/hooks'
import { HistoryTab } from './HistoryTab'
import { OverviewTab } from './OverviewTab'
import { SendTab } from './SendTab'
import { SessionsTab } from './SessionsTab'
import { CopyButton, Notice } from './ui'

type Tab = 'overview' | 'send' | 'history' | 'sessions'

const TABS: { id: Tab; label: string; icon: typeof Send }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'send', label: 'Send', icon: Send },
  { id: 'history', label: 'History', icon: History },
  { id: 'sessions', label: 'Sessions', icon: ShieldCheck },
]

export function Dashboard({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('overview')
  const balance = useUsdcBalance()

  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-5 sm:pt-8">
      <section className="relative overflow-hidden rounded-[1.5rem] border-[3px] border-white bg-sunset p-5 shadow-[0_0_0_3px_#000,0_14px_50px_rgba(255,47,142,0.3)] sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-white [text-shadow:0_1px_0_#000]">Your ArcPay name</div>
            <h1 className="logo-text mt-1 max-w-full break-all text-4xl sm:text-5xl">@{me.username}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/70 px-3 py-1 font-mono text-xs">{shortAddress(me.wallet)}</span>
              <CopyButton value={me.wallet} label="Copy address" className="!min-h-9 !bg-black/60 !py-1 !text-xs" />
            </div>
          </div>
          <div className="rounded-2xl border-2 border-black bg-black/75 px-5 py-3 text-right">
            <div className="label flex items-center justify-end gap-1.5">
              <TokenUSDC variant="branded" size={16} /> USDC balance
            </div>
            <div className="mt-0.5 text-3xl font-bold tabular-nums sm:text-4xl">
              {balance.data !== undefined ? Amount.fromRaw(balance.data, 6).toFixed(2) : '...'}
            </div>
            <a
              className="mt-1 inline-flex items-center gap-1 text-xs text-white/60 underline"
              href={`${CHAIN.explorerBase}/address/${USDC_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {CHAIN.name} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      {!IS_MAINNET ? (
        <div className="mt-3">
          <Notice tone="info">
            You are on Arc Testnet with test funds.{' '}
            <a className="font-bold underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              Get test USDC
            </a>
          </Notice>
        </div>
      ) : null}

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Dashboard sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border-2 px-4 text-sm font-bold transition-colors ${
              tab === id ? 'border-black bg-sunset text-white shadow-[0_0_0_2px_#fff]' : 'border-white/20 text-white/70 hover:border-white/40 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'overview' ? <OverviewTab me={me} onSend={() => setTab('send')} /> : null}
        {tab === 'send' ? <SendTab /> : null}
        {tab === 'history' ? <HistoryTab /> : null}
        {tab === 'sessions' ? <SessionsTab /> : null}
      </div>
    </div>
  )
}
