import { useSwitchChain } from 'wagmi'
import { CHAIN, CHAIN_ID } from '@/lib/env'
import { useSession } from '@/lib/session'
import { Card, Notice, SectionTitle, Spinner } from './ui'

export function SetupNeeded({ databaseConfigured, error }: { databaseConfigured: boolean; error: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card active>
        <SectionTitle hint="The storage layer is not ready. This is a one-time admin step.">Admin setup needed</SectionTitle>
        {error ? <Notice tone="error">Database connection failed: {error}</Notice> : null}
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-white/80">
          <li>
            Run <code className="rounded bg-white/10 px-1.5 py-0.5">bun run setup</code> and enter your Turso database URL and auth token
            {databaseConfigured ? ' again (the saved ones did not work)' : ''}.
          </li>
          <li>Restart the backend with <code className="rounded bg-white/10 px-1.5 py-0.5">bun run server</code>.</li>
        </ol>
        <p className="mt-4 text-xs text-white/50">The database credentials are stored only in the server&apos;s .env file and is never sent to the browser.</p>
      </Card>
    </div>
  )
}

export function BackendOffline() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card active>
        <SectionTitle hint="The ArcPay backend did not answer.">Backend offline</SectionTitle>
        <p className="text-sm text-white/75">
          Start it with <code className="rounded bg-white/10 px-1.5 py-0.5">bun run server</code>, then reload this page.
        </p>
      </Card>
    </div>
  )
}

export function WrongNetwork() {
  const { switchChain, isPending, error } = useSwitchChain()
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card active>
        <SectionTitle hint={`ArcPay runs on ${CHAIN.name}. Switch networks to continue.`}>Wrong network</SectionTitle>
        <button type="button" className="btn-sunset w-full" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
          {isPending ? <Spinner /> : null}
          Switch to {CHAIN.name}
        </button>
        {error ? <p className="mt-3 text-sm text-red-300">Could not switch automatically. Change the network in your wallet.</p> : null}
      </Card>
    </div>
  )
}

export function SignInGate() {
  const { status, signIn } = useSession()
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card active>
        <SectionTitle hint="Prove you own this wallet with a free signature. No gas, no funds move.">Sign in</SectionTitle>
        <button type="button" className="btn-sunset w-full" disabled={status === 'signing'} onClick={() => void signIn()}>
          {status === 'signing' ? <Spinner /> : null}
          {status === 'signing' ? 'Check your wallet' : 'Sign message'}
        </button>
      </Card>
    </div>
  )
}

export function ContractMissing() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card active>
        <SectionTitle hint="The ArcPay smart contract address is not configured.">Contract not set</SectionTitle>
        <p className="text-sm text-white/75">
          Deploy it with <code className="rounded bg-white/10 px-1.5 py-0.5">bun run deploy:testnet</code>, then set{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5">VITE_ARCPAY_ADDRESS</code> in .env and restart.
        </p>
      </Card>
    </div>
  )
}
