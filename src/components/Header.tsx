import { usePrivy } from '@privy-io/react-auth'
import { useAccount } from 'wagmi'
import { Wallet } from 'lucide-react'
import { CHAIN, IS_MAINNET } from '@/lib/env'
import { Logo } from './Brand'

export function ConnectButton({ label = 'Connect Wallet', big = false }: { label?: string; big?: boolean }) {
  const { login, logout, authenticated, ready } = usePrivy()
  const { address, isConnected } = useAccount()

  const truncated = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null

  if (!ready) {
    return (
      <button type="button" disabled className="btn-ghost opacity-50">
        <Wallet className="h-4 w-4" /> Loading...
      </button>
    )
  }

  if (isConnected || authenticated) {
    return (
      <button
        type="button"
        onClick={() => logout()}
        className="btn-ghost"
        title="Click to disconnect"
      >
        <Wallet className="h-4 w-4" />
        {truncated || 'Connected'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => login()}
      className={big ? 'btn-sunset w-full px-8 py-4 text-lg sm:w-auto' : 'btn-sunset'}
    >
      <Wallet className="h-4 w-4" />
      {label}
    </button>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-white/10 bg-black/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <a href="/" aria-label="ArcPay home">
          <Logo className="text-2xl sm:text-3xl" />
        </a>
        <div className="flex items-center gap-2">
          <span
            className={`hidden rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider sm:inline ${
              IS_MAINNET ? 'border-sunset-orange text-sunset-orange' : 'border-white/30 text-white/70'
            }`}
          >
            {CHAIN.name}
          </span>
          <ConnectButton label="Connect" />
        </div>
      </div>
    </header>
  )
}
