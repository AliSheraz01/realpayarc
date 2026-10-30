import { parseUsdc } from '../src/onchain-money'
import { AppError } from './errors'

export type Command =
  | { kind: 'send' | 'tip'; recipient?: string; amount?: string }
  | { kind: 'link'; code?: string }
  | { kind: 'start' | 'help' | 'receive' | 'balance' | 'history' | 'unlink' | 'cancel' | 'unknown' }

const ADDRESS = /0x[0-9a-fA-F]{40}/
const HANDLE = /@[a-zA-Z0-9_]{3,32}/
const NUMBER = /\d+(?:[.,]\d+)?/

function cleanAmount(value: string | undefined): string | undefined {
  return value ? value.replace(',', '.') : undefined
}

/** Pull "who" and "how much" out of free text such as "send $5 to @alice" or "pay alice 2.5 usdc". */
function parseTransfer(kind: 'send' | 'tip', body: string): Command {
  let rest = body.trim()
  let recipient: string | undefined

  const explicit = rest.match(ADDRESS) ?? rest.match(HANDLE)
  if (explicit) {
    recipient = explicit[0]
    rest = rest.replace(explicit[0], ' ')
  } else {
    const afterTo = rest.match(/\b(?:to|for)\s+([a-zA-Z][a-zA-Z0-9_]{2,31})\b/i)
    const afterVerb = rest.match(/^(?:\s*)([a-zA-Z][a-zA-Z0-9_]{2,31})\b(?=\s|$)/)
    const candidate = afterTo ?? afterVerb
    const word = candidate?.[1]
    if (word && !/^(usdc|usd|dollars?|bucks|some|a|the)$/i.test(word)) {
      recipient = word
      rest = rest.replace(candidate[0], ' ')
    }
  }

  const amount = cleanAmount(rest.match(NUMBER)?.[0])
  return { kind, recipient, amount }
}

export function parseCommand(input: string): Command {
  const text = input.trim()
  if (!text) return { kind: 'unknown' }

  const slash = text.match(/^\/([a-zA-Z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/)
  if (slash) {
    const name = slash[1].toLowerCase()
    const args = (slash[2] ?? '').trim()
    switch (name) {
      case 'start':
        return { kind: 'start' }
      case 'help':
        return { kind: 'help' }
      case 'send':
      case 'pay':
        return parseTransfer('send', args)
      case 'tip':
        return parseTransfer('tip', args)
      case 'receive':
      case 'request':
        return { kind: 'receive' }
      case 'balance':
        return { kind: 'balance' }
      case 'history':
        return { kind: 'history' }
      case 'link':
        return { kind: 'link', code: args || undefined }
      case 'unlink':
        return { kind: 'unlink' }
      case 'cancel':
        return { kind: 'cancel' }
      default:
        return { kind: 'unknown' }
    }
  }

  const lower = text.toLowerCase()
  const verb = lower.match(/^(?:please\s+|can you\s+|i want to\s+|i'd like to\s+)?(send|pay|transfer|give|wire|tip)\b\s*([\s\S]*)$/)
  if (verb) return parseTransfer(verb[1] === 'tip' ? 'tip' : 'send', text.slice(text.toLowerCase().indexOf(verb[1]) + verb[1].length))

  if (/\b(my (address|wallet|username)|receive|deposit|qr)\b/.test(lower)) return { kind: 'receive' }
  if (/\b(balance|how much (do i have|usdc)|funds)\b/.test(lower)) return { kind: 'balance' }
  if (/\b(history|transactions?|recent|activity)\b/.test(lower)) return { kind: 'history' }
  if (/\b(help|how does this work|commands)\b/.test(lower)) return { kind: 'help' }
  if (/^(hi|hello|hey|yo)\b/.test(lower)) return { kind: 'start' }
  return { kind: 'unknown' }
}

/** Convert a user-typed amount to 6-decimal USDC base units, with friendly errors. */
export function toRawUsdc(amount: string | undefined): bigint {
  if (!amount) throw new AppError('missing_amount', 'How much USDC? For example: send 5 to @alice')
  try {
    const raw = parseUsdc(amount)
    if (raw <= 0n) throw new AppError('invalid_amount', 'Enter an amount greater than zero.')
    return raw
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('invalid_amount', 'USDC amounts can have at most 6 decimal places, like 2.50.')
  }
}
