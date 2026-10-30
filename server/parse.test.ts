import { describe, expect, test } from 'bun:test'
import { parseCommand, toRawUsdc } from './parse'

describe('parseCommand', () => {
  test('natural send', () => {
    expect(parseCommand('send 5 usdc to @alice')).toEqual({ kind: 'send', recipient: '@alice', amount: '5' })
    expect(parseCommand('Send $2.50 to @bob_99')).toEqual({ kind: 'send', recipient: '@bob_99', amount: '2.50' })
    expect(parseCommand('pay carol 10')).toEqual({ kind: 'send', recipient: 'carol', amount: '10' })
  })

  test('handle containing digits does not become the amount', () => {
    expect(parseCommand('send 3 to @user123')).toEqual({ kind: 'send', recipient: '@user123', amount: '3' })
  })

  test('tip and slash commands', () => {
    expect(parseCommand('/tip @dave 1')).toEqual({ kind: 'tip', recipient: '@dave', amount: '1' })
    expect(parseCommand('/send@ArcPayBot @erin 0,5')).toEqual({ kind: 'send', recipient: '@erin', amount: '0.5' })
    expect(parseCommand('/tip 2')).toEqual({ kind: 'tip', recipient: undefined, amount: '2' })
  })

  test('wallet address recipient', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678'
    expect(parseCommand(`send 4 to ${address}`)).toEqual({ kind: 'send', recipient: address, amount: '4' })
  })

  test('other intents', () => {
    expect(parseCommand('what is my balance')).toEqual({ kind: 'balance' })
    expect(parseCommand('show history')).toEqual({ kind: 'history' })
    expect(parseCommand('/receive')).toEqual({ kind: 'receive' })
    expect(parseCommand('/link ARC-ABCD-EFGH-JKLM')).toEqual({ kind: 'link', code: 'ARC-ABCD-EFGH-JKLM' })
    expect(parseCommand('gibberish words')).toEqual({ kind: 'unknown' })
  })
})

describe('toRawUsdc', () => {
  test('parses 6 decimals', () => {
    expect(toRawUsdc('2.5')).toBe(2_500_000n)
    expect(toRawUsdc('0.000001')).toBe(1n)
  })
  test('rejects bad input', () => {
    expect(() => toRawUsdc(undefined)).toThrow()
    expect(() => toRawUsdc('0')).toThrow()
    expect(() => toRawUsdc('1.1234567')).toThrow()
  })
})
