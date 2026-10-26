import { useEffect, useRef, useState } from 'react'
import { Client, type IMessage } from '@stomp/stompjs'
import { config } from '../../config'
import { refreshAccessToken } from '../../lib/apiClient'
import { tokenStore } from '../../lib/tokenStore'
import { useSession } from '../auth/hooks'
import { clearActiveClient, setActiveClient } from './realtimeBus'

export type RealtimeState = 'connecting' | 'connected' | 'disconnected' | 'unauthorized' | 'limited' | 'mock'

export function useRealtime() {
  const { session } = useSession()
  const [state, setState] = useState<RealtimeState>('disconnected')
  const [lastPong, setLastPong] = useState<string | null>(null)
  const authFailures = useRef(0)
  const shutdown = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (!session || config.useMockApi) return
    let disposed = false
    let terminalError = false
    let attempts = 0
    const refreshOnce = () => {
      if (authFailures.current >= 1) return
      authFailures.current++
      void refreshAccessToken().catch(() => { if (!disposed) setState('disconnected') })
    }
    const url = new URL('/ws', config.apiBaseUrl || window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const client = new Client({
      brokerURL: url.toString(),
      reconnectDelay: 3000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      connectionTimeout: 5000,
      // Authentication data must never be logged.
      debug: () => {},
      beforeConnect: () => {
        if (disposed) return
        setState('connecting')
        client.connectHeaders = { Authorization: `Bearer ${tokenStore.get() ?? ''}` }
      },
      onConnect: () => {
        if (disposed) return
        attempts = 0
        authFailures.current = 0
        setState('connected')
        setActiveClient(client)
        client.subscribe('/user/queue/session', (message: IMessage) => {
          try {
            const value = JSON.parse(message.body)
            if (value.type === 'session:pong' && typeof value.ts === 'string') setLastPong(value.ts)
          } catch { /* Ignore malformed diagnostics without rendering server content. */ }
        })
        client.publish({ destination: '/app/session/ping', body: '{}' })
      },
      onStompError: (frame) => {
        clearActiveClient(client)
        if (disposed) return
        let code = frame.headers.message
        try { code = JSON.parse(frame.body).error.code } catch { /* Use the STOMP message code. */ }
        client.reconnectDelay = 0
        terminalError = true
        setState(code === 'rate_limited' ? 'limited' : 'unauthorized')
        void client.deactivate()
        if (code === 'unauthorized') refreshOnce()
      },
      onWebSocketClose: (event) => {
        clearActiveClient(client)
        if (disposed || terminalError) return
        if (event.code === 1008) {
          // stompjs 7 chốt độ trễ reconnect lúc kích hoạt, nên reconnectDelay = 0 là chưa đủ:
          // phải deactivate để không kết nối lại bằng token đã hết hạn. Socket mới được tạo khi có token mới.
          client.reconnectDelay = 0
          terminalError = true
          void client.deactivate()
          setState('unauthorized')
          refreshOnce()
        } else {
          setState('disconnected')
          if (++attempts >= 5) { client.reconnectDelay = 0; void client.deactivate() }
        }
      },
    })
    // Finish closing the old socket before replacement, including when all five slots are occupied.
    void shutdown.current.then(() => { if (!disposed) client.activate() })
    return () => { disposed = true; clearActiveClient(client); shutdown.current = client.deactivate() }
  }, [session])

  return { state: config.useMockApi ? 'mock' as const : state, lastPong }
}
