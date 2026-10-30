import { formatUsdc } from '../src/onchain-money'
import type { Recipient } from './services'
import { escapeHtml } from './telegram-api'

const VIA_LABEL: Record<Recipient['via'], string> = {
  onchain: 'registered ArcPay username',
  telegram: 'linked Telegram handle (not a registered ArcPay name)',
  address: 'wallet address',
}

export interface ConfirmationInput {
  verb: 'Send' | 'Tip'
  amount: bigint
  recipient: Recipient
  /** Network fee taken from the user's limit. Only for spending-limit sends. */
  fee?: bigint
  /** USDC left in today's limit after this payment. Only for spending-limit sends. */
  leftToday?: bigint
  /** How the payment will go out. */
  mode: 'limit' | 'sign'
  /** Extra line shown under the details, for example why a signature is needed. */
  note?: string
}

/**
 * The message people read before money moves. It always shows who gets paid in three ways: the name they typed,
 * where that name came from, and the full wallet address, so a wrong person is easy to spot.
 */
export function confirmationText(input: ConfirmationInput): string {
  const { recipient } = input
  const lines = [
    `<b>Confirm ${input.verb === 'Tip' ? 'tip' : 'payment'}</b>`,
    `Amount: <b>${formatUsdc(input.amount)} USDC</b>`,
    `To: <b>${escapeHtml(recipient.label)}</b> (${VIA_LABEL[recipient.via]})`,
    'Wallet:',
    `<code>${escapeHtml(recipient.wallet)}</code>`,
  ]

  if (input.mode === 'limit') {
    const fee = input.fee ?? 0n
    lines.push(fee > 0n ? `Network fee: ${formatUsdc(fee)} USDC (gas for the bot wallet, from your limit)` : 'Network fee: none')
    if (input.leftToday !== undefined) lines.push(`Left in today's limit after this: ${formatUsdc(input.leftToday)} USDC`)
  }

  if (input.note) lines.push('', escapeHtml(input.note))
  lines.push(
    '',
    input.mode === 'limit'
      ? 'Is this the right person? Tap Confirm to send from your spending limit. No wallet signature needed. Payments cannot be reversed.'
      : 'Is this the right person? Open the link, check the details again, and sign in your wallet. Nothing moves until you sign.',
  )
  return lines.join('\n')
}
