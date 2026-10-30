type Notifier = (telegramId: number, text: string) => Promise<void>

let notifier: Notifier | undefined

/** The Telegram bot registers itself here so the indexer and API can message linked users. */
export function setNotifier(fn: Notifier): void {
  notifier = fn
}

export async function notifyTelegram(telegramId: number, text: string): Promise<void> {
  if (!notifier) return
  try {
    await notifier(telegramId, text)
  } catch (error) {
    console.warn('[notify] telegram message failed:', error instanceof Error ? error.message : error)
  }
}
