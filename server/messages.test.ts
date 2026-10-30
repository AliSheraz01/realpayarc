import { describe, expect, test } from 'bun:test'
import { confirmationText } from './messages'

const WALLET = '0x1234567890abcdef1234567890abcdef12345678' as const

describe('confirmationText', () => {
  test('shows the name, where it came from, and the full wallet address', () => {
    const text = confirmationText({
      verb: 'Send',
      amount: 5_000_000n,
      recipient: { wallet: WALLET, label: '@bob', via: 'onchain' },
      fee: 10_000n,
      leftToday: 14_990_000n,
      mode: 'limit',
    })
    expect(text).toContain('@bob')
    expect(text).toContain('registered ArcPay username')
    expect(text).toContain(`<code>${WALLET}</code>`)
    expect(text).toContain('5 USDC')
    expect(text).toContain('Tap Confirm')
  })

  test('warns when the name is only a Telegram handle', () => {
    const text = confirmationText({
      verb: 'Tip',
      amount: 1_000_000n,
      recipient: { wallet: WALLET, label: '@bob (Telegram)', via: 'telegram' },
      mode: 'sign',
    })
    expect(text).toContain('not a registered ArcPay name')
    expect(text).toContain('sign in your wallet')
    expect(text).not.toContain('Tap Confirm')
  })

  test('shows a typed wallet address and escapes markup in names', () => {
    const text = confirmationText({
      verb: 'Send',
      amount: 1n,
      recipient: { wallet: WALLET, label: '<b>x</b>', via: 'address' },
      mode: 'sign',
    })
    expect(text).toContain('wallet address')
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
