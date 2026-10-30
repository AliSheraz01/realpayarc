import { describe, expect, test } from 'bun:test'
import { AppError } from './errors'
import { requiresSignature, sendDelegated } from './relayer'

const OWNER = '0x1111111111111111111111111111111111111111'
const TO = '0x2222222222222222222222222222222222222222'
const MEMO = `0x${'00'.repeat(32)}` as const

describe('signature threshold', () => {
  test('under 50 USDC is automatic, 50 USDC and above needs a signature', () => {
    expect(requiresSignature(49_999_999n)).toBe(false)
    expect(requiresSignature(50_000_000n)).toBe(true)
    expect(requiresSignature(1_000_000_000n)).toBe(true)
  })

  test('the relayer refuses a large payment before touching the network', async () => {
    const error = await sendDelegated(OWNER, TO, 50_000_000n, 10_000n, MEMO).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('needs_signature')
  })
})
