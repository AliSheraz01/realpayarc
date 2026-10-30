import { AtSign, Send, Wallet } from 'lucide-react'
import { IS_MAINNET } from '@/lib/env'
import { HeroArt, Logo } from './Brand'
import { ConnectButton } from './Header'
import { Card } from './ui'

const STEPS = [
  {
    icon: Wallet,
    title: 'Connect',
    body: 'Link your wallet and claim a username on Arc. You only pay the network fee.',
  },
  {
    icon: AtSign,
    title: 'Pair Telegram',
    body: 'Copy a one-time pairing code from the dashboard and send it to the ArcPay bot.',
  },
  {
    icon: Send,
    title: 'Send and tip',
    body: 'Say "send 5 to @alice". You approve every payment in your own wallet. Real USDC, settled onchain.',
  },
]

export function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:pt-10">
      <HeroArt>
        <h1 className="sr-only">ArcPay</h1>
        <div className="flex flex-col items-center gap-2">
          <Logo className="text-6xl sm:text-8xl" />
          <p className="heading-outline mt-3 text-balance text-lg sm:text-2xl">Send USDC to @anyone</p>
        </div>
        <p className="mx-auto mt-6 max-w-md text-pretty text-sm font-medium text-white sm:text-base [text-shadow:0_2px_0_#000,0_0_12px_rgba(0,0,0,0.6)]">
          Pay by username on the web or in Telegram. Non-custodial, settled in USDC on {IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'}.
        </p>
        <div className="mt-7 flex justify-center">
          <ConnectButton big label="Connect Wallet" />
        </div>
      </HeroArt>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <Card key={step.title}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sunset text-white shadow-[0_0_0_2px_#000]">
                <step.icon className="h-5 w-5" />
              </span>
              <span className="label">Step {index + 1}</span>
            </div>
            <h3 className="heading-outline mt-3 text-lg">{step.title}</h3>
            <p className="mt-1.5 text-pretty text-sm text-white/70">{step.body}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
