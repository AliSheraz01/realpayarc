import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { api, ApiError } from './api'

type Status = 'signed-out' | 'signing' | 'signed-in'

interface SessionValue {
  status: Status
  token: string | null
  signIn: () => Promise<void>
  /** Ends the web session on the server. Pass disconnectWallet to also drop the wallet connection. */
  signOut: (disconnectWallet?: boolean) => Promise<void>
  /** Called by API consumers when the server says the session is gone. */
  expire: () => void
}

interface Auth {
  wallet: string
  token: string
}

const SessionContext = createContext<SessionValue | null>(null)
const storageKey = (wallet: string) => `arcpay.session.${wallet.toLowerCase()}`

function readStored(wallet: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(wallet))
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync } = useSignMessage()
  const [auth, setAuth] = useState<Auth | null>(null)
  const [signing, setSigning] = useState(false)
  const attempted = useRef<string | null>(null)

  // The token only counts for the wallet it was issued to, so switching wallets signs you out by derivation.
  const wallet = isConnected && address ? address.toLowerCase() : null
  const token = auth && wallet && auth.wallet === wallet ? auth.token : null
  const status: Status = token ? 'signed-in' : signing ? 'signing' : 'signed-out'

  const clear = useCallback(() => {
    if (address) window.localStorage.removeItem(storageKey(address))
    setAuth(null)
  }, [address])

  const signIn = useCallback(async () => {
    if (!address) return
    setSigning(true)
    try {
      const { nonce, message } = await api<{ nonce: string; message: string }>('/auth/nonce', {
        method: 'POST',
        body: { address },
      })
      const signature = await signMessageAsync({ message })
      const result = await api<{ token: string }>('/auth/verify', {
        method: 'POST',
        body: { address, nonce, signature },
      })
      window.localStorage.setItem(storageKey(address), result.token)
      setAuth({ wallet: address.toLowerCase(), token: result.token })
    } catch (error) {
      const rejected = /user rejected|denied|rejected/i.test(error instanceof Error ? error.message : '')
      if (!rejected) toast.error(error instanceof ApiError ? error.message : 'Could not sign in. Try again.')
    } finally {
      setSigning(false)
    }
  }, [address, signMessageAsync])

  // On connect: restore a stored session, otherwise ask for one free signature.
  useEffect(() => {
    if (!wallet || !address) {
      attempted.current = null
      return
    }
    if (attempted.current === wallet) return
    attempted.current = wallet

    const stored = readStored(address)
    if (!stored) {
      queueMicrotask(() => void signIn())
      return
    }
    api('/me', { token: stored })
      .then(() => setAuth({ wallet, token: stored }))
      .catch((error: unknown) => {
        window.localStorage.removeItem(storageKey(address))
        if (!(error instanceof ApiError && error.status === 0)) void signIn()
      })
  }, [wallet, address, signIn])

  const signOut = useCallback(
    async (disconnectWallet = false) => {
      if (token) await api('/auth/logout', { method: 'POST', token }).catch(() => undefined)
      clear()
      if (disconnectWallet) disconnect()
    },
    [token, clear, disconnect],
  )

  const value = useMemo<SessionValue>(
    () => ({ status, token, signIn, signOut, expire: clear }),
    [status, token, signIn, signOut, clear],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside SessionProvider')
  return value
}
