import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { StompSubscription } from '@stomp/stompjs'
import { getActiveClient, onActiveClientChange } from '../realtime/realtimeBus'
import { adminApi, type AdminStats } from './adminApi'

const statsKey = ['admin', 'stats'] as const
export interface StatsSample extends AdminStats { at: number }

function isStats(value: unknown): value is AdminStats {
  if (!value || typeof value !== 'object') return false
  return ['connections', 'onlineUsers', 'msgPerSec', 'activeRooms'].every((key) => {
    const n = (value as Record<string, unknown>)[key]
    return typeof n === 'number' && Number.isFinite(n) && n >= 0
  })
}

export function useAdminStats() {
  const queryClient = useQueryClient()
  const [history, setHistory] = useState<StatsSample[]>([])
  const [lastPushAt, setLastPushAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const query = useQuery({
    queryKey: statsKey,
    queryFn: adminApi.stats,
    retry: false,
    // Keep a REST fallback even if the socket connects but no admin events arrive.
    refetchInterval: now - lastPushAt < 4000 ? false : 3000,
    staleTime: 0,
  })

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let subscription: StompSubscription | undefined
    const bind = (client: ReturnType<typeof getActiveClient>) => {
      subscription?.unsubscribe()
      subscription = undefined
      if (!client?.connected) return
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      subscription = client.subscribe('/user/queue/admin', (frame) => {
        try {
          const event = JSON.parse(frame.body)
          if (event.type !== 'admin:stats' || !isStats(event.payload)) return
          const at = Date.now()
          setLastPushAt(at)
          queryClient.setQueryData(statsKey, event.payload)
          setHistory((samples) => [...samples.filter((s) => s.at > at - 60_000), { ...event.payload, at }].slice(-60))
        } catch { /* Ignore invalid telemetry frames. */ }
      })
    }
    bind(getActiveClient())
    const off = onActiveClientChange(bind)
    return () => { off(); subscription?.unsubscribe() }
  }, [queryClient])

  const fresh = query.dataUpdatedAt > 0 && now - query.dataUpdatedAt < 6000
  return { ...query, history, fresh, live: now - lastPushAt < 4000, lastPushAt }
}
