import { formatUsdc } from '../src/onchain-money'
import { memoFromIntentId, shortAddress, usdcBalance } from './chain'
import { getKv, isoIn, nowIso, setKv, type Db } from './db'
import { env } from './env'
import { AppError, rateLimit } from './errors'
import { setNotifier } from './notify'
import { confirmationText } from './messages'
import { parseCommand, toRawUsdc, type Command } from './parse'
import {
  delegationAvailable,
  explainBlock,
  feeFor,
  getDelegationState,
  requiresSignature,
  sendDelegated,
  signatureMessage,
} from './relayer'
import {
  createIntent,
  getIntent,
  getLinkByTelegram,
  getUsername,
  listPayments,
  looksLikePairingCode,
  redeemPairingCode,
  resolveRecipient,
  type Recipient,
  type TelegramLink,
} from './services'
import {
  escapeHtml,
  TelegramApi,
  type InlineButton,
  type TgCallback,
  type TgMessage,
  type TgUpdate,
} from './telegram-api'

interface FlowState {
  step: 'recipient' | 'amount'
  kind: 'send' | 'tip'
  recipient?: string
}

export const botStatus = { running: false, username: null as string | null, lastError: null as string | null }

const MAIN_MENU: InlineButton[][] = [
  [
    { text: 'Send', callback_data: 'm:send' },
    { text: 'Tip', callback_data: 'm:tip' },
    { text: 'Receive', callback_data: 'm:receive' },
  ],
  [
    { text: 'Balance', callback_data: 'm:balance' },
    { text: 'History', callback_data: 'm:history' },
    { text: 'Link wallet', callback_data: 'm:link' },
  ],
]

const TIP_CHIPS: InlineButton[][] = [
  [
    { text: '0.50', callback_data: 'amt:0.5' },
    { text: '1', callback_data: 'amt:1' },
    { text: '2', callback_data: 'amt:2' },
    { text: '5', callback_data: 'amt:5' },
  ],
  [{ text: 'Cancel', callback_data: 'x:cancel' }],
]

const HELP = [
  'ArcPay moves real USDC on Arc. Your wallet always signs the payment, I never hold your funds.',
  '',
  'Try:',
  'send 5 to @alice',
  'tip @alice 1 (or reply to someone with /tip 1)',
  '/receive  /balance  /history',
  '/link CODE  to connect your wallet',
  '/unlink  to disconnect it',
].join('\n')

const LINK_HELP =
  'Your wallet is not linked yet. Open the ArcPay dashboard, connect your wallet, copy your pairing code, and send it to me here.'

export function startBot(db: Db): void {
  if (!env.botToken) {
    console.log('[bot] TELEGRAM_BOT_TOKEN not set, Telegram bot disabled')
    return
  }
  const api = new TelegramApi(env.botToken)
  setNotifier((telegramId, text) => api.sendMessage(telegramId, text))
  void run(db, api)
}

async function run(db: Db, api: TelegramApi): Promise<void> {
  try {
    const me = await api.getMe()
    botStatus.username = me.username
    await api.call('deleteWebhook')
    await api.call('setMyCommands', {
      commands: [
        { command: 'start', description: 'Open the menu' },
        { command: 'send', description: 'Send USDC: /send @alice 5' },
        { command: 'tip', description: 'Tip someone: /tip @alice 1' },
        { command: 'receive', description: 'Show how to get paid' },
        { command: 'balance', description: 'Your USDC balance' },
        { command: 'history', description: 'Recent payments' },
        { command: 'link', description: 'Link your wallet with a pairing code' },
        { command: 'unlink', description: 'Disconnect this Telegram account' },
      ],
    })
    botStatus.running = true
    console.log(`[bot] @${me.username} is running`)
  } catch (error) {
    botStatus.lastError = error instanceof Error ? error.message : String(error)
    console.error('[bot] failed to start:', botStatus.lastError)
    return
  }

  let offset = Number((await getKv(db, 'tg_offset')) ?? 0)
  for (;;) {
    try {
      const updates = await api.getUpdates(offset)
      for (const update of updates) {
        offset = update.update_id + 1
        await handleUpdate(db, api, update).catch((error) => console.error('[bot] update failed:', error))
      }
      if (updates.length > 0) await setKv(db, 'tg_offset', String(offset))
      botStatus.lastError = null
    } catch (error) {
      botStatus.lastError = error instanceof Error ? error.message : String(error)
      await Bun.sleep(3000)
    }
  }
}

async function handleUpdate(db: Db, api: TelegramApi, update: TgUpdate): Promise<void> {
  if (update.message?.text && update.message.from && !update.message.from.is_bot) {
    await handleMessage(db, api, update.message)
  } else if (update.callback_query) {
    await handleCallback(db, api, update.callback_query)
  }
}

// ---------- state ----------

async function getState(db: Db, telegramId: number): Promise<FlowState | null> {
  const row = await db.get<{ state: string }>('select state from tg_state where telegram_id = ? and updated_at > ?', [
    telegramId,
    isoIn(-10 * 60_000),
  ])
  return row ? (JSON.parse(row.state) as FlowState) : null
}

async function setState(db: Db, telegramId: number, state: FlowState | null): Promise<void> {
  if (!state) {
    await db.run('delete from tg_state where telegram_id = ?', [telegramId])
    return
  }
  await db.run(
    'insert into tg_state (telegram_id, state, updated_at) values (?, ?, ?) on conflict (telegram_id) do update set state = excluded.state, updated_at = excluded.updated_at',
    [telegramId, JSON.stringify(state), nowIso()],
  )
}

// ---------- message handling ----------

async function handleMessage(db: Db, api: TelegramApi, msg: TgMessage): Promise<void> {
  const from = msg.from
  const text = msg.text?.trim()
  if (!from || !text) return
  const chatId = msg.chat.id
  const isPrivate = msg.chat.type === 'private'

  const reply = (body: string, keyboard?: InlineButton[][], html = false) =>
    api.sendMessage(chatId, body, { keyboard, html })

  try {
    rateLimit(`tg:${from.id}`, 30, 60_000)
    const link = await getLinkByTelegram(db, from.id)
    if (link && (link.telegramUsername ?? '') !== (from.username ?? '')) {
      await db.run('update telegram_links set telegram_username = ? where telegram_id = ?', [from.username ?? null, from.id])
      link.telegramUsername = from.username ?? null
    }

    let command = parseCommand(text)

    if (command.kind === 'link' || looksLikePairingCode(text)) {
      const code = command.kind === 'link' ? command.code : text
      if (!isPrivate) {
        await reply('Pairing codes only work in a private chat with me. Message me directly and generate a fresh code.')
        return
      }
      await handleLink(db, reply, from.id, from.username ?? null, code)
      return
    }

    // Continue a guided Send / Tip flow when the user answers with plain text.
    const state = isPrivate ? await getState(db, from.id) : null
    if (state && command.kind === 'unknown') {
      command = state.step === 'recipient'
        ? { kind: state.kind, recipient: text }
        : { kind: state.kind, recipient: state.recipient, amount: text }
    }

    if (command.kind === 'send' || command.kind === 'tip') {
      await handleTransfer(db, reply, command, msg, link)
      return
    }

    if (!isPrivate && command.kind !== 'help' && command.kind !== 'start') {
      await reply('For your privacy, I only answer that in a private chat. In groups I handle /tip and /send.')
      return
    }

    await handleSimple(db, reply, command, from.id, link)
  } catch (error) {
    await reply(userMessage(error))
  }
}

type Reply = (body: string, keyboard?: InlineButton[][], html?: boolean) => Promise<void>

function userMessage(error: unknown): string {
  if (error instanceof AppError) return error.message
  console.error('[bot] unexpected error:', error)
  return 'Something went wrong on my side. Please try again in a moment.'
}

async function handleSimple(
  db: Db,
  reply: Reply,
  command: Command,
  telegramId: number,
  link: TelegramLink | null,
): Promise<void> {
  switch (command.kind) {
    case 'start':
    case 'help': {
      await setState(db, telegramId, null)
      const intro = link ? HELP : `${HELP}\n\n${LINK_HELP}`
      await reply(intro, MAIN_MENU)
      return
    }
    case 'cancel':
      await setState(db, telegramId, null)
      await reply('Cancelled.', MAIN_MENU)
      return
    case 'unlink': {
      if (!link) return reply('This Telegram account is not linked to a wallet.')
      await db.run('delete from telegram_links where telegram_id = ?', [telegramId])
      return reply('Disconnected. I can no longer prepare payments for that wallet. Link again any time with a new pairing code.')
    }
    case 'receive': {
      if (!link) return reply(LINK_HELP)
      const username = await getUsername(db, link.wallet)
      const lines = [
        username ? `Your ArcPay username: <b>@${escapeHtml(username)}</b>` : 'You have not registered an on-chain username yet. Do it on the dashboard.',
        link.telegramUsername ? `Your Telegram handle: @${escapeHtml(link.telegramUsername)}` : 'Set a Telegram username in Telegram settings so people can pay you by handle.',
        '',
        'Your wallet address on Arc:',
        `<code>${link.wallet}</code>`,
      ]
      return reply(lines.join('\n'), undefined, true)
    }
    case 'balance': {
      if (!link) return reply(LINK_HELP)
      const balance = await usdcBalance(link.wallet)
      return reply(`Balance: ${formatUsdc(balance)} USDC on ${env.chainName}\nWallet: ${shortAddress(link.wallet)}`)
    }
    case 'history': {
      if (!link) return reply(LINK_HELP)
      const payments = await listPayments(db, link.wallet, 5)
      if (payments.length === 0) return reply('No payments yet. Try: send 1 to @alice')
      const lines = payments.map((p) => {
        const who = p.counterpartyName ? `@${p.counterpartyName}` : shortAddress(p.direction === 'sent' ? p.to : p.from)
        return `${p.direction === 'sent' ? 'Sent' : 'Received'} ${formatUsdc(BigInt(p.amount))} USDC ${p.direction === 'sent' ? 'to' : 'from'} ${who}`
      })
      return reply(lines.join('\n'))
    }
    default:
      return reply("I didn't catch that. Try: send 5 to @alice, or tap a button.", MAIN_MENU)
  }
}

async function handleLink(
  db: Db,
  reply: Reply,
  telegramId: number,
  username: string | null,
  code: string | undefined,
): Promise<void> {
  if (!code) {
    await reply('Send me your pairing code from the dashboard, like: /link ARC-ABCD-EFGH-JKLM')
    return
  }
  rateLimit(`pair:${telegramId}`, 5, 10 * 60_000)
  const result = await redeemPairingCode(db, code, telegramId, username)
  if (!result) {
    await reply('That code is invalid, already used, or expired. Generate a new one on the dashboard (codes last 10 minutes).')
    return
  }
  const lines = [
    `Linked. Wallet ${shortAddress(result.wallet)}${result.username ? ` (@${result.username})` : ''} is now connected to this Telegram account.`,
  ]
  if (!result.username) lines.push('Register an on-chain username on the dashboard so friends can pay you by name.')
  if (!username) lines.push('You have no Telegram username. Set one in Telegram settings so people can pay @you here.')
  await reply(lines.join('\n'), MAIN_MENU)
}

async function resolveReplyTarget(db: Db, msg: TgMessage): Promise<Recipient | null> {
  const target = msg.reply_to_message?.from
  if (!target || target.is_bot) return null
  if (target.id === msg.from?.id) throw new AppError('self_payment', 'You cannot send USDC to yourself.')

  const link = await getLinkByTelegram(db, target.id)
  if (link) {
    return { wallet: link.wallet, label: target.username ? `@${target.username} (Telegram)` : shortAddress(link.wallet), via: 'telegram' }
  }
  if (!target.username) {
    throw new AppError('missing_handle', 'That person has no Telegram username and has not linked a wallet, so I cannot find where to send.')
  }
  return resolveRecipient(db, target.username)
}

async function handleTransfer(
  db: Db,
  reply: Reply,
  command: Extract<Command, { kind: 'send' | 'tip' }>,
  msg: TgMessage,
  link: TelegramLink | null,
): Promise<void> {
  const telegramId = msg.from?.id
  if (!telegramId) return
  if (!link) return reply(LINK_HELP)

  const replyTarget = command.recipient ? null : await resolveReplyTarget(db, msg)
  const recipientInput = command.recipient

  if (!replyTarget && !recipientInput) {
    await setState(db, telegramId, { step: 'recipient', kind: command.kind })
    return reply(`Who do you want to ${command.kind === 'tip' ? 'tip' : 'send USDC to'}? Reply with @username or a wallet address (0x...).`, [
      [{ text: 'Cancel', callback_data: 'x:cancel' }],
    ])
  }

  if (!command.amount) {
    await setState(db, telegramId, {
      step: 'amount',
      kind: command.kind,
      recipient: recipientInput ?? replyTarget?.wallet,
    })
    return reply(
      `How much USDC${recipientInput ? ` to ${recipientInput}` : ''}?`,
      command.kind === 'tip' ? TIP_CHIPS : [[{ text: 'Cancel', callback_data: 'x:cancel' }]],
    )
  }

  const raw = toRawUsdc(command.amount)
  const recipient = replyTarget ?? (await resolveRecipient(db, recipientInput ?? ''))
  await presentIntent(db, reply, link, recipient, raw, command.kind, telegramId)
}

async function presentIntent(
  db: Db,
  reply: Reply,
  link: TelegramLink,
  recipient: Recipient,
  amount: bigint,
  kind: 'send' | 'tip',
  telegramId: number,
): Promise<void> {
  await setState(db, telegramId, null)
  const intent = await createIntent(db, { sender: link.wallet, recipient, amount, kind, source: 'telegram', telegramId })
  const verb = kind === 'tip' ? 'Tip' : 'Send'
  const cancelRow: InlineButton[] = [{ text: 'Cancel', callback_data: `ic:${intent.id}` }]

  // Under the signature threshold and inside the spending limit: one tap on Confirm sends it, no wallet signature.
  // At or above the threshold the payment always goes through the signed web flow below.
  let note: string | undefined
  if (delegationAvailable && requiresSignature(amount)) {
    note = signatureMessage()
  } else if (delegationAvailable) {
    try {
      const state = await getDelegationState(link.wallet)
      const fee = feeFor(state)
      const blocked = explainBlock(state, amount, fee)
      if (blocked === null) {
        await reply(
          confirmationText({ verb, amount, recipient, fee, leftToday: state.remainingToday - amount - fee, mode: 'limit' }),
          [[{ text: 'Confirm and send', callback_data: `ok:${intent.id}` }], cancelRow],
          true,
        )
        return
      }
      if (state.active) note = `${blocked} Approve this one in your wallet instead.`
    } catch (error) {
      console.warn('[bot] could not read spending limit:', error instanceof Error ? error.message : error)
    }
  }

  const keyboard: InlineButton[][] = []
  const lines = [confirmationText({ verb, amount, recipient, mode: 'sign', note })]
  if (env.appUrl.startsWith('https://')) {
    keyboard.push([{ text: 'Review and sign in wallet', url: `${env.appUrl}/?pay=${intent.id}` }])
  } else {
    lines.push('', 'Open the ArcPay dashboard and finish this under Send, Pending requests.')
  }
  keyboard.push(cancelRow)
  await reply(lines.join('\n'), keyboard, true)
}

// ---------- buttons ----------

async function handleCallback(db: Db, api: TelegramApi, cb: TgCallback): Promise<void> {
  const chatId = cb.message?.chat.id
  if (!chatId || !cb.data) return
  const reply: Reply = (body, keyboard, html) => api.sendMessage(chatId, body, { keyboard, html })

  try {
    rateLimit(`tg:${cb.from.id}`, 30, 60_000)
    await api.answerCallback(cb.id)
    const link = await getLinkByTelegram(db, cb.from.id)
    const [action, arg] = cb.data.split(':')
    const fakeMessage: TgMessage = { message_id: 0, from: cb.from, chat: cb.message!.chat }

    if (action === 'm' && (arg === 'send' || arg === 'tip')) {
      await handleTransfer(db, reply, { kind: arg }, fakeMessage, link)
    } else if (action === 'm' && arg === 'link') {
      await reply('Open the ArcPay dashboard, connect your wallet, copy the pairing code and send it to me here.')
    } else if (action === 'm' && link === null && arg !== 'receive') {
      await reply(LINK_HELP)
    } else if (action === 'm' && arg) {
      await handleSimple(db, reply, { kind: arg as 'receive' | 'balance' | 'history' }, cb.from.id, link)
    } else if (action === 'amt') {
      const state = await getState(db, cb.from.id)
      if (!state || state.step !== 'amount') return reply('That request expired. Tap Tip to start again.', MAIN_MENU)
      await handleTransfer(db, reply, { kind: state.kind, recipient: state.recipient, amount: arg }, fakeMessage, link)
    } else if (action === 'x') {
      await setState(db, cb.from.id, null)
      await reply('Cancelled.', MAIN_MENU)
    } else if (action === 'ok' && arg) {
      if (!link) return reply(LINK_HELP)
      await runDelegated(db, reply, link, arg)
    } else if (action === 'ic' && arg && link) {
      const changed = await db.run(
        "update payment_intents set status = 'cancelled' where id = ? and sender_wallet = ? and status = 'pending'",
        [arg, link.wallet],
      )
      await reply(changed > 0 ? 'Request cancelled.' : 'That request is no longer pending.')
    }
  } catch (error) {
    await reply(userMessage(error))
  }
}

/** Confirm button: the relayer sends the payment inside the user's onchain spending limit. */
async function runDelegated(db: Db, reply: Reply, link: TelegramLink, intentId: string): Promise<void> {
  const intent = await getIntent(db, intentId)
  if (!intent || intent.senderWallet !== link.wallet) return reply('I could not find that request.')
  if (intent.status !== 'pending') return reply(`That request is already ${intent.status}.`)

  // Claim it first so a double tap can never send twice.
  const claimed = await db.run(
    "update payment_intents set status = 'sending' where id = ? and sender_wallet = ? and status = 'pending'",
    [intentId, link.wallet],
  )
  if (claimed === 0) return reply('That request is already being handled.')

  const amount = BigInt(intent.amount)
  try {
    const state = await getDelegationState(link.wallet)
    const fee = feeFor(state)
    const blocked = explainBlock(state, amount, fee)
    if (blocked) throw new AppError('limit', blocked)

    const hash = await sendDelegated(link.wallet, intent.recipientWallet, amount, fee, memoFromIntentId(intentId))
    await db.run("update payment_intents set status = 'submitted', tx_hash = ? where id = ?", [hash, intentId])
    await reply(
      `Sent ${formatUsdc(amount)} USDC to ${intent.recipientLabel}${fee > 0n ? ` (+${formatUsdc(fee)} network fee)` : ''}.\n${env.explorerBase}/tx/${hash}`,
    )
  } catch (error) {
    const failedOnchain = error instanceof AppError && error.code === 'tx_failed'
    await db.run('update payment_intents set status = ? where id = ?', [failedOnchain ? 'failed' : 'pending', intentId])
    // A pending request can still be finished by signing in the web app.
    await reply(
      failedOnchain ? userMessage(error) : `${userMessage(error)} You can still approve it yourself in the web app.`,
      !failedOnchain && env.appUrl.startsWith('https://')
        ? [[{ text: 'Review and sign in wallet', url: `${env.appUrl}/?pay=${intentId}` }]]
        : undefined,
    )
  }
}
