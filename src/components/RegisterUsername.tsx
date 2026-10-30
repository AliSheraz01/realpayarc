import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import { arcPayAbi, USERNAME_PATTERN } from '@/lib/arcpay-abi'
import { ARCPAY_ADDRESS, buildTxLink, CHAIN_ID } from '@/lib/env'
import { friendlyError } from '@/lib/errors'
import { useAuthedApi } from '@/lib/queries'
import { Card, Notice, SectionTitle, Spinner } from './ui'

type Step = 'idle' | 'committing' | 'waiting' | 'revealing' | 'syncing'

interface Pending {
  name: string
  salt: Hex
  committedAt: number
}

const pendingKey = (wallet: string) => `arcpay.registration.${wallet.toLowerCase()}`
const MAX_AGE_MS = 23 * 60 * 60 * 1000

function loadPending(wallet: string): Pending | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(wallet))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Pending
    return Date.now() - parsed.committedAt < MAX_AGE_MS ? parsed : null
  } catch {
    return null
  }
}

function randomSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

const STEP_LABELS: { id: Step; label: string }[] = [
  { id: 'committing', label: 'Reserve' },
  { id: 'waiting', label: 'Secure' },
  { id: 'revealing', label: 'Claim' },
]

export function RegisterUsername() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const call = useAuthedApi()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(() => (address ? loadPending(address) : null))
  const [lastTx, setLastTx] = useState<string | null>(null)

  const valid = USERNAME_PATTERN.test(name)
  const availability = useReadContract({
    address: ARCPAY_ADDRESS,
    abi: arcPayAbi,
    functionName: 'isAvailable',
    args: [name],
    chainId: CHAIN_ID,
    query: { enabled: valid && Boolean(ARCPAY_ADDRESS) && step === 'idle' },
  })

  const busy = step !== 'idle'
  const targetName = pending?.name ?? name

  const hint = useMemo(() => {
    if (!name) return 'Letters, numbers and underscores. 3 to 32 characters.'
    if (!valid) return 'Use 3 to 32 lowercase letters, numbers or underscores. Do not start with an underscore.'
    if (availability.isLoading) return 'Checking availability...'
    if (availability.data === false) return 'That username is taken.'
    if (availability.data === true) return 'Available.'
    return ''
  }, [name, valid, availability.isLoading, availability.data])

  async function reveal(payload: Pending) {
    if (!address || !publicClient || !ARCPAY_ADDRESS) return
    setStep('waiting')

    // Wait for the real on-chain minimum age: compare chain time with the commitment timestamp.
    const commitment = keccak256(
      encodeAbiParameters(
        [{ type: 'string' }, { type: 'address' }, { type: 'bytes32' }],
        [payload.name, address, payload.salt],
      ),
    )
    const [committedTs, minAge] = await Promise.all([
      publicClient.readContract({ address: ARCPAY_ADDRESS, abi: arcPayAbi, functionName: 'commitTimestamp', args: [commitment] }),
      publicClient.readContract({ address: ARCPAY_ADDRESS, abi: arcPayAbi, functionName: 'MIN_COMMITMENT_AGE' }),
    ])
    if (committedTs === 0n) throw new Error('commitment missing')
    for (;;) {
      const block = await publicClient.getBlock()
      if (block.timestamp >= committedTs + minAge) break
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }

    setStep('revealing')
    const hash = await writeContractAsync({
      address: ARCPAY_ADDRESS,
      abi: arcPayAbi,
      functionName: 'register',
      args: [payload.name, payload.salt],
      chainId: CHAIN_ID,
    })
    setLastTx(hash)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('Transaction reverted')

    setStep('syncing')
    await call<{ username: string | null }>('/me/sync-username', { method: 'POST' })
    window.localStorage.removeItem(pendingKey(address))
    setPending(null)
    await queryClient.invalidateQueries({ queryKey: ['me'] })
    toast.success(`@${payload.name} is yours.`)
  }

  async function start() {
    if (!address || !publicClient || !ARCPAY_ADDRESS) return
    setError(null)
    try {
      let payload = pending
      if (!payload) {
        const salt = randomSalt()
        const commitment = keccak256(
          encodeAbiParameters([{ type: 'string' }, { type: 'address' }, { type: 'bytes32' }], [name, address, salt]),
        )
        setStep('committing')
        const hash = await writeContractAsync({
          address: ARCPAY_ADDRESS,
          abi: arcPayAbi,
          functionName: 'commit',
          args: [commitment],
          chainId: CHAIN_ID,
        })
        setLastTx(hash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        payload = { name, salt, committedAt: Date.now() }
        window.localStorage.setItem(pendingKey(address), JSON.stringify(payload))
        setPending(payload)
      }
      await reveal(payload)
      setStep('idle')
    } catch (caught) {
      const friendly = friendlyError(caught)
      setStep('idle')
      if (!friendly.cancelled) setError(friendly.message)
    }
  }

  function discard() {
    if (address) window.localStorage.removeItem(pendingKey(address))
    setPending(null)
    setError(null)
  }

  const activeIndex = STEP_LABELS.findIndex((s) => s.id === step)

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card active>
        <SectionTitle hint="Pick the name people will use to pay you. It is registered onchain, permanent, and tied to this wallet.">
          Claim your username
        </SectionTitle>

        {pending && !busy ? (
          <Notice tone="info">
            You already reserved <strong>@{pending.name}</strong>. Finish the claim to make it yours.
          </Notice>
        ) : (
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-white/50">@</span>
              <input
                id="username"
                className="field pl-9 lowercase"
                value={name}
                disabled={busy}
                maxLength={32}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="yourname"
                onChange={(event) => setName(event.target.value.trim().toLowerCase())}
              />
            </div>
            <p className={`mt-2 text-sm ${availability.data === false || (name && !valid) ? 'text-red-300' : availability.data ? 'text-emerald-300' : 'text-white/55'}`}>
              {hint}
            </p>
          </div>
        )}

        {busy ? (
          <ol className="mt-5 space-y-2" aria-live="polite">
            {STEP_LABELS.map((item, index) => {
              const done = step === 'syncing' || index < activeIndex
              const current = index === activeIndex
              return (
                <li key={item.id} className="flex items-center gap-3 text-sm">
                  {done ? <Check className="h-4 w-4 text-emerald-300" /> : current ? <Spinner /> : <Circle className="h-4 w-4 text-white/30" />}
                  <span className={current ? 'font-bold' : done ? 'text-white/70' : 'text-white/40'}>
                    {item.id === 'committing' && 'Reserve @' + targetName + ' (approve in wallet)'}
                    {item.id === 'waiting' && 'Securing your name onchain'}
                    {item.id === 'revealing' && 'Claim it (approve in wallet)'}
                  </span>
                </li>
              )
            })}
            {step === 'syncing' ? (
              <li className="flex items-center gap-3 text-sm font-bold">
                <Spinner /> Linking the name to your account
              </li>
            ) : null}
          </ol>
        ) : null}

        {error ? (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}

        <button
          type="button"
          className="btn-sunset mt-5 w-full"
          disabled={busy || (!pending && (!valid || availability.data !== true))}
          onClick={() => void start()}
        >
          {busy ? <Spinner /> : null}
          {busy ? 'Working' : pending ? `Finish claiming @${pending.name}` : name ? `Claim @${name}` : 'Claim username'}
        </button>

        {pending && !busy ? (
          <button type="button" className="btn-ghost mt-3 w-full" onClick={discard}>
            Choose a different name
          </button>
        ) : null}

        {lastTx ? (
          <a className="mt-3 block text-center text-xs text-white/55 underline" href={buildTxLink(lastTx)} target="_blank" rel="noopener noreferrer">
            View last transaction
          </a>
        ) : null}

        <p className="mt-5 text-pretty text-xs text-white/50">
          Two tiny transactions, only the network fee in USDC. The first reserves your name privately, the second claims it, so nobody can
          snipe it while it is pending.
        </p>
      </Card>
    </div>
  )
}
