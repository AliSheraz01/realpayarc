import { ConnectKitButton } from 'connectkit'
import { Wallet } from 'lucide-react'
import { CHAIN, IS_MAINNET } from '@/lib/env'
import { Logo } from './Brand'

export function ConnectButton({ label = 'Connect Wallet', big = false }: { label?: string; big?: boolean }) {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, isConnecting, show, truncatedAddress }) => (
        <button
          type="button"
          onClick={show}
          className={isConnected ? 'btn-ghost' : `btn-sunset ${big ? 'w-full px-8 py-4 text-lg sm:w-auto' : ''}`}
        >
          <Wallet className="h-4 w-4" />
          {isConnected ? truncatedAddress : isConnecting ? 'Connecting...' : label}
        </button>
      )}
    </ConnectKitButton.Custom>
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
