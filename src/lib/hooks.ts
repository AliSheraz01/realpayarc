import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi'
import type { Intent } from './api'
import { arcPayAbi } from './arcpay-abi'
import { ARCPAY_ADDRESS, CHAIN_ID, memoFromIntentId, USDC_ADDRESS } from './env'
import { friendlyError } from './errors'
import { useAuthedApi } from './queries'

/** Keep this much USDC spare for fees. On Arc, gas is paid from the same USDC balance. */
export const GAS_RESERVE = 50_000n

/** Single USDC balance, ERC-20 view (6 decimals). On Arc the native balance is the same pool, so it is not read separately. */
export function useUsdcBalance() {
  const { address } = useAccount()
  return useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 6_000 },
  })
}

export type PayStep = 'idle' | 'approving' | 'paying' | 'confirming' | 'done'

/** Runs approve (when needed) then ArcPay.pay for a payment request, reporting each real stage. */
export function usePayIntent() {
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const call = useAuthedApi()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<PayStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  async function pay(intent: Intent): Promise<boolean> {
    setError(null)
    if (!address || !publicClient || !ARCPAY_ADDRESS) {
      setError('Connect your wallet first.')
      return false
    }
    if (address.toLowerCase() !== intent.senderWallet.toLowerCase()) {
      setError('This request belongs to a different wallet. Connect the wallet you linked in Telegram.')
      return false
    }

    const amount = BigInt(intent.amount)
    try {
      const balance = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
      if (balance < amount) {
        setError('Insufficient USDC for this payment.')
        return false
      }
      if (balance - amount < GAS_RESERVE) {
        setError('That would leave too little USDC for network fees. Gas is paid in USDC on Arc.')
        return false
      }

      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, ARCPAY_ADDRESS],
      })
      if (allowance < amount) {
        setStep('approving')
        const approveHash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ARCPAY_ADDRESS, amount],
          chainId: CHAIN_ID,
        })
        const approval = await publicClient.waitForTransactionReceipt({ hash: approveHash })
        if (approval.status !== 'success') throw new Error('Approval reverted')
      }

      setStep('paying')
      const hash = await writeContractAsync({
        address: ARCPAY_ADDRESS,
        abi: arcPayAbi,
        functionName: 'pay',
        args: [intent.recipientWallet as `0x${string}`, amount, memoFromIntentId(intent.id)],
        chainId: CHAIN_ID,
      })
      setTxHash(hash)
      await call(`/intents/${intent.id}/submitted`, { method: 'POST', body: { txHash: hash } }).catch(() => undefined)

      setStep('confirming')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Payment reverted')

      setStep('done')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['intents'] }),
      ])
      return true
    } catch (caught) {
      const friendly = friendlyError(caught)
      setStep('idle')
      if (!friendly.cancelled) setError(friendly.message)
      return false
    }
  }

  function reset() {
    setStep('idle')
    setError(null)
    setTxHash(null)
  }

  return { pay, step, error, txHash, reset }
}
