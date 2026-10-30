import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, type Address } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { ShieldCheck, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { arcPayDelegateAbi } from '@/lib/arcpay-abi'
import { CHAIN_ID, shortAddress, USDC_ADDRESS } from '@/lib/env'
import { friendlyError } from '@/lib/errors'
import { useAuthedApi, useHealth } from '@/lib/queries'
import { useSession } from '@/lib/session'
import { Card, Notice, SectionTitle, Spinner } from './ui'

interface DelegationInfo {
  available: boolean
  relayer: Address | null
  contract: Address | null
  state: {
    active: boolean
    perPaymentLimit: string
    dailyLimit: string
    remainingToday: string
    expiry: number
    maxFee: string
    allowance: string
  } | null
  botFee?: string
  manualSignFrom?: string
}

const DAY_OPTIONS = [7, 30, 90]

function parseAmount(value: string, allowZero = false): bigint | null {
  try {
    const raw = parseUsdc(value)
    return raw > 0n || (allowZero && raw === 0n) ? raw : null
  } catch {
    return null
  }
}

export function SpendingLimitCard() {
  const call = useAuthedApi()
  const { token } = useSession()
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()

  const [perPayment, setPerPayment] = useState('5')
  const [daily, setDaily] = useState('20')
  const [maxFee, setMaxFee] = useState('0.05')
  const [days, setDays] = useState(30)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['delegation', token],
    queryFn: () => call<DelegationInfo>('/delegation'),
    enabled: Boolean(token),
    refetchInterval: 8_000,
  })

  const info = query.data
  const relayerLow = useHealth().data?.relayer?.low ?? false
  const state = info?.state
  const perRaw = parseAmount(perPayment)
  const dailyRaw = parseAmount(daily)
  const feeRaw = parseAmount(maxFee, true)
  const validLimits = perRaw !== null && dailyRaw !== null && feeRaw !== null && perRaw <= dailyRaw && feeRaw <= perRaw
  const totalRaw = dailyRaw !== null ? dailyRaw * BigInt(days) : null

  async function wait(hash: `0x${string}`) {
    const receipt = await publicClient?.waitForTransactionReceipt({ hash })
    if (receipt?.status !== 'success') throw new Error('Transaction reverted')
  }

  async function turnOn() {
    if (!info?.contract || !info.relayer || !publicClient || !address || !validLimits || perRaw === null || dailyRaw === null || feeRaw === null || totalRaw === null) return
    setError(null)
    try {
      setBusy('approve')
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, info.contract],
      })
      if (allowance < totalRaw) {
        await wait(
          await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'approve',
            args: [info.contract, totalRaw],
            chainId: CHAIN_ID,
          }),
        )
      }

      setBusy('enable')
      const block = await publicClient.getBlock()
      // Use chain time and stay an hour inside the 90 day cap.
      const expiry = block.timestamp + BigInt(days * 86_400) - 3_600n
      await wait(
        await writeContractAsync({
          address: info.contract,
          abi: arcPayDelegateAbi,
          functionName: 'setDelegation',
          args: [info.relayer, perRaw, dailyRaw, expiry, feeRaw],
          chainId: CHAIN_ID,
        }),
      )
      toast.success('Spending limit is on. The bot can now send within it.')
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: ['delegation'] })
    } catch (caught) {
      const friendly = friendlyError(caught)
      if (!friendly.cancelled) setError(friendly.message)
    } finally {
      setBusy(null)
    }
  }

  async function turnOff() {
    if (!info?.contract || !publicClient) return
    setError(null)
    try {
      setBusy('revoke')
      await wait(
        await writeContractAsync({ address: info.contract, abi: arcPayDelegateAbi, functionName: 'revokeDelegation', chainId: CHAIN_ID }),
      )
      setBusy('approval')
      await wait(
        await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [info.contract, 0n],
          chainId: CHAIN_ID,
        }),
      )
      toast.success('Spending limit is off.')
      await queryClient.invalidateQueries({ queryKey: ['delegation'] })
    } catch (caught) {
      const friendly = friendlyError(caught)
      if (!friendly.cancelled) setError(friendly.message)
    } finally {
      setBusy(null)
    }
  }

  const busyLabel =
    busy === 'approve' ? 'Approve USDC in your wallet' : busy === 'enable' ? 'Confirm the limit in your wallet' : busy === 'revoke' ? 'Turning off' : 'Clearing approval'

  if (query.isLoading) {
    return (
      <Card>
        <Spinner />
      </Card>
    )
  }

  if (!info?.available) {
    return (
      <Card>
        <SectionTitle hint="Let the bot send without a signature each time.">Bot spending limit</SectionTitle>
        <Notice tone="warn">
          Not set up on this server yet. The admin needs RELAYER_PRIVATE_KEY and VITE_DELEGATE_ADDRESS in .env, then a backend restart.
        </Notice>
      </Card>
    )
  }

  const showForm = !state?.active || editing

  return (
    <Card active={Boolean(state?.active)}>
      <SectionTitle hint="Pre-approve a budget so the bot can send in Telegram with one tap and no wallet signature.">Bot spending limit</SectionTitle>

      {relayerLow ? (
        <div className="mb-3">
          <Notice tone="warn">The bot&apos;s payment wallet is low on gas, so some bot payments may ask for your signature until the admin tops it up.</Notice>
        </div>
      ) : null}

      {state?.active && !editing ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
            <ShieldCheck className="h-4 w-4" /> On
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="label">Per payment</dt>
              <dd className="font-bold tabular-nums">{formatUsdc(BigInt(state.perPaymentLimit))} USDC</dd>
            </div>
            <div>
              <dt className="label">Per day</dt>
              <dd className="font-bold tabular-nums">{formatUsdc(BigInt(state.dailyLimit))} USDC</dd>
            </div>
            <div>
              <dt className="label">Left today</dt>
              <dd className="font-bold tabular-nums">{formatUsdc(BigInt(state.remainingToday))} USDC</dd>
            </div>
            <div>
              <dt className="label">Expires</dt>
              <dd className="font-bold">{new Date(state.expiry * 1000).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="label">Network fee cap</dt>
              <dd className="font-bold tabular-nums">{formatUsdc(BigInt(state.maxFee))} USDC</dd>
            </div>
            <div>
              <dt className="label">USDC approved</dt>
              <dd className="font-bold tabular-nums">{formatUsdc(BigInt(state.allowance))} USDC</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setEditing(true)}>
              Change limits
            </button>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void turnOff()}>
              {busy ? <Spinner /> : null}
              {busy ? busyLabel : 'Turn off'}
            </button>
          </div>
        </div>
      ) : null}

      {showForm ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="per-payment">
                Max per payment
              </label>
              <input id="per-payment" className="field mt-1.5 tabular-nums" inputMode="decimal" value={perPayment} onChange={(e) => setPerPayment(e.target.value.trim())} />
            </div>
            <div>
              <label className="label" htmlFor="per-day">
                Max per day
              </label>
              <input id="per-day" className="field mt-1.5 tabular-nums" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value.trim())} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="max-fee">
              Max network fee per payment
            </label>
            <input id="max-fee" className="field mt-1.5 tabular-nums" inputMode="decimal" value={maxFee} onChange={(e) => setMaxFee(e.target.value.trim())} />
            <p className="mt-1.5 text-xs text-white/50">
              Gas on Arc is paid in USDC. The bot wallet pays it and is repaid this fee from your USDC, inside your limits.
              {info.botFee ? ` Right now it asks ${formatUsdc(BigInt(info.botFee))} USDC.` : ''}
            </p>
          </div>
          <div>
            <div className="label">Valid for</div>
            <div className="mt-1.5 flex gap-2">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className={`min-h-11 flex-1 rounded-xl border-2 text-sm font-bold ${
                    days === option ? 'border-black bg-sunset text-white shadow-[0_0_0_2px_#fff]' : 'border-white/20 text-white/70'
                  }`}
                >
                  {option} days
                </button>
              ))}
            </div>
          </div>

          {!validLimits && (perPayment || daily) ? (
            <p className="text-sm text-red-300">Enter amounts with up to 6 decimals. The per-payment limit cannot exceed the daily limit, and the fee cap cannot exceed the per-payment limit.</p>
          ) : null}

          {validLimits && totalRaw !== null ? (
            <Notice tone="warn">
              The bot&apos;s wallet ({info.relayer ? shortAddress(info.relayer) : 'bot wallet'}) will be able to send your USDC to anyone you ask it to, up to
              {' '}{perPayment} per payment and {daily} per day (network fees included), until it expires. The most it can ever move is {formatUsdc(totalRaw)} USDC. Keep the limits
              small and turn it off any time.
            </Notice>
          ) : null}

          {error ? <Notice tone="error">{error}</Notice> : null}

          <div className="flex flex-wrap gap-2.5">
            <button type="button" className="btn-sunset" disabled={busy !== null || !validLimits} onClick={() => void turnOn()}>
              {busy ? <Spinner /> : <Zap className="h-4 w-4" />}
              {busy ? busyLabel : state?.active ? 'Update limit' : 'Turn on spending limit'}
            </button>
            {editing ? (
              <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
                Cancel
              </button>
            ) : null}
          </div>
          <p className="text-xs text-white/50">
            {info.manualSignFrom
              ? `Bot payments under ${formatUsdc(BigInt(info.manualSignFrom))} USDC send with one Confirm tap in Telegram, no wallet signature, inside these limits. Payments of ${formatUsdc(BigInt(info.manualSignFrom))} USDC or more always need your signature in the web app. `
              : ''}
            Two wallet confirmations, once: approve USDC for the limit, then set it. After that the bot needs no signature.</p>
        </div>
      ) : null}

      {!showForm && error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </Card>
  )
}
