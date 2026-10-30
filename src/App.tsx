import { useAccount } from 'wagmi'
import { PalmBackdrop } from '@/components/Brand'
import { Dashboard } from '@/components/Dashboard'
import { BackendOffline, ContractMissing, SetupNeeded, SignInGate, WrongNetwork } from '@/components/Gates'
import { Header } from '@/components/Header'
import { Landing } from '@/components/Landing'
import { PayRequest } from '@/components/PayRequest'
import { RegisterUsername } from '@/components/RegisterUsername'
import { Spinner } from '@/components/ui'
import { ARCPAY_ADDRESS, CHAIN_ID } from '@/lib/env'
import { useHealth, useMe } from '@/lib/queries'
import { SessionProvider, useSession } from '@/lib/session'

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-white/70">
      <Spinner className="h-5 w-5" /> {label}
    </div>
  )
}

function Screen() {
  const health = useHealth()
  const { isConnected, isReconnecting, chainId } = useAccount()
  const { status } = useSession()
  const me = useMe()
  const payId = new URLSearchParams(window.location.search).get('pay')

  if (health.isLoading) return <Loading label="Starting up" />
  if (health.isError || !health.data) return <BackendOffline />
  if (!health.data.database.ready) {
    return <SetupNeeded databaseConfigured={health.data.database.configured} error={health.data.database.error} />
  }
  if (!ARCPAY_ADDRESS) return <ContractMissing />
  if (isReconnecting) return <Loading label="Reconnecting wallet" />
  if (!isConnected) return <Landing />
  if (chainId !== CHAIN_ID) return <WrongNetwork />
  if (status !== 'signed-in') return <SignInGate />
  if (me.isLoading || !me.data) return <Loading label="Loading your account" />
  if (payId && /^[0-9a-f]{32}$/.test(payId)) return <PayRequest id={payId} />
  if (!me.data.username) return <RegisterUsername />
  return <Dashboard me={me.data} />
}

export default function App() {
  return (
    <SessionProvider>
      <PalmBackdrop />
      <Header />
      <main>
        <Screen />
      </main>
    </SessionProvider>
  )
}
