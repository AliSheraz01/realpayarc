import { useQuery } from '@tanstack/react-query'
import type { Intent } from '@/lib/api'
import { useAuthedApi } from '@/lib/queries'
import { IntentPayer } from './IntentPayer'
import { Card, Notice, SectionTitle, Spinner } from './ui'

/** Landing page for payment links sent by the Telegram bot (`/?pay=<id>`). */
export function PayRequest({ id }: { id: string }) {
  const call = useAuthedApi()
  const query = useQuery({
    queryKey: ['intent', id],
    queryFn: () => call<{ intent: Intent }>(`/intents/${id}`),
    refetchInterval: 5_000,
    retry: false,
  })

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card active>
        <SectionTitle hint="Created in Telegram. Nothing moves until you sign in your wallet.">Payment request</SectionTitle>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Spinner /> Loading request
          </div>
        ) : query.error ? (
          <Notice tone="error">
            {query.error.message || 'Request not found.'} Make sure you are connected with the same wallet you linked in Telegram.
          </Notice>
        ) : query.data ? (
          <IntentPayer intent={query.data.intent} />
        ) : null}
      </Card>
      <a href="/" className="mt-4 block text-center text-sm text-white/60 underline">
        Back to dashboard
      </a>
    </div>
  )
}
