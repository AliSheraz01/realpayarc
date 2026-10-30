import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, type Health, type Intent, type Me, type PaymentItem, type SessionItem, type TelegramLinkInfo } from './api'
import { useSession } from './session'

type Options = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }

/** API caller that attaches the session token and ends the session on a 401. */
export function useAuthedApi() {
  const { token, expire } = useSession()
  return useCallback(
    async <T>(path: string, options: Options = {}): Promise<T> => {
      try {
        return await api<T>(path, { ...options, token })
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) expire()
        throw error
      }
    },
    [token, expire],
  )
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health'),
    refetchInterval: 15_000,
    retry: false,
  })
}

export function useMe() {
  const call = useAuthedApi()
  const { token } = useSession()
  return useQuery({
    queryKey: ['me', token],
    queryFn: () => call<Me>('/me'),
    enabled: Boolean(token),
    refetchInterval: 6_000,
  })
}

export function usePayments() {
  const call = useAuthedApi()
  const { token } = useSession()
  return useQuery({
    queryKey: ['payments', token],
    queryFn: () => call<{ payments: PaymentItem[]; indexer: Health['indexer'] }>('/payments'),
    enabled: Boolean(token),
    refetchInterval: 4_000,
  })
}

export function useIntents() {
  const call = useAuthedApi()
  const { token } = useSession()
  return useQuery({
    queryKey: ['intents', token],
    queryFn: () => call<{ intents: Intent[] }>('/intents'),
    enabled: Boolean(token),
    refetchInterval: 5_000,
  })
}

export function useSessions() {
  const call = useAuthedApi()
  const { token } = useSession()
  return useQuery({
    queryKey: ['sessions', token],
    queryFn: () => call<{ web: SessionItem[]; telegram: TelegramLinkInfo | null }>('/sessions'),
    enabled: Boolean(token),
    refetchInterval: 10_000,
  })
}
