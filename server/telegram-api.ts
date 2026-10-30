/** Minimal Telegram Bot API client (plain fetch, no SDK). */

export interface TgUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
}

export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
  text?: string
  reply_to_message?: { from?: TgUser }
}

export interface TgCallback {
  id: string
  from: TgUser
  data?: string
  message?: TgMessage
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallback
}

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
}

export interface SendOptions {
  keyboard?: InlineButton[][]
  html?: boolean
}

export class TelegramApi {
  constructor(private readonly token: string) {}

  async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await response.json()) as { ok: boolean; result: T; description?: string }
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? response.status}`)
    return json.result
  }

  getMe(): Promise<{ id: number; username: string }> {
    return this.call('getMe')
  }

  getUpdates(offset: number): Promise<TgUpdate[]> {
    return this.call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] })
  }

  async sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.html ? 'HTML' : undefined,
      disable_web_page_preview: true,
      reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
    })
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text })
  }
}

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
