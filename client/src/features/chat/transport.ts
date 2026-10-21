import type { Client, IMessage } from '@stomp/stompjs'
import { ApiError, type ApiErrorBody } from '../../lib/apiError'
import { onActiveClientChange, getActiveClient } from '../realtime/realtimeBus'
import type { ClientEvents, ClientEventType, ServerEvent } from './types'

export const ACK_TIMEOUT_MS = 10_000

export interface ChatTransport {
  /** Gửi event và chờ application ack (theo correlationId). */
  request<T extends ClientEventType>(type: T, payload: ClientEvents[T]['payload']): Promise<ClientEvents[T]['ack']>
  /** Nhận event server đẩy xuống. */
  onEvent(listener: (event: ServerEvent) => void): () => void
  /** Gọi mỗi lần (re)connect thành công, để tải lại dữ liệu có thể đã lỡ. */
  onConnected(listener: () => void): () => void
}

export const DESTINATIONS: Record<ClientEventType, string> = {
  'room:join': '/app/room.join',
  'room:leave': '/app/room.leave',
  'message:send': '/app/message.send',
}

const STATUS_BY_CODE: Record<string, number> = {
  invalid_payload: 400, unauthorized: 401, forbidden: 403, rate_limited: 429,
}

interface Pending {
  resolve: (data: unknown) => void
  reject: (error: ApiError) => void
  timer: ReturnType<typeof setTimeout>
}

type AckFrame =
  | { type: 'ack'; payload: { correlationId: string; ok: true; data: unknown } }
  | { type: 'ack'; payload: { correlationId: string; ok: false; error: ApiErrorBody['error'] } }

const networkError = (message: string) => new ApiError(0, { code: 'network_error', message })

/** Transport STOMP dùng chung socket của useRealtime (xem realtimeBus). */
export function createStompTransport(): ChatTransport {
  const pending = new Map<string, Pending>()
  const eventListeners = new Set<(event: ServerEvent) => void>()
  const connectedListeners = new Set<() => void>()

  const settle = (correlationId: string) => {
    const entry = pending.get(correlationId)
    if (entry) {
      clearTimeout(entry.timer)
      pending.delete(correlationId)
    }
    return entry
  }

  const handleAck = (message: IMessage) => {
    let frame: AckFrame
    try {
      frame = JSON.parse(message.body)
    } catch {
      return
    }
    if (frame?.type !== 'ack' || !frame.payload?.correlationId) return
    const entry = settle(frame.payload.correlationId)
    if (!entry) return
    if (frame.payload.ok) entry.resolve(frame.payload.data)
    else {
      const error = frame.payload.error ?? { code: 'unknown' as const }
      entry.reject(new ApiError(STATUS_BY_CODE[error.code] ?? 0, error))
    }
  }

  const handleEvent = (message: IMessage) => {
    let event: ServerEvent
    try {
      event = JSON.parse(message.body)
    } catch {
      return
    }
    if (event?.type !== 'message:new') return
    for (const listener of eventListeners) listener(event)
  }

  const attach = (client: Client | null) => {
    if (!client) {
      // Mất kết nối: không thể còn ack nào đến cho các request đang chờ.
      for (const [id, entry] of pending) {
        settle(id)
        entry.reject(networkError('Connection lost'))
      }
      return
    }
    client.subscribe('/user/queue/acks', handleAck)
    client.subscribe('/user/queue/events', handleEvent)
    for (const listener of connectedListeners) listener()
  }

  onActiveClientChange(attach)
  if (getActiveClient()) attach(getActiveClient())

  return {
    request(type, payload) {
      const client = getActiveClient()
      if (!client) return Promise.reject(networkError('Not connected'))
      const correlationId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(correlationId)
          reject(networkError('Ack timeout'))
        }, ACK_TIMEOUT_MS)
        pending.set(correlationId, { resolve: resolve as (data: unknown) => void, reject, timer })
        try {
          client.publish({
            destination: DESTINATIONS[type],
            body: JSON.stringify({ type, payload, ts: new Date().toISOString(), correlationId }),
          })
        } catch {
          settle(correlationId)
          reject(networkError('Send failed'))
        }
      })
    },
    onEvent(listener) {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    onConnected(listener) {
      connectedListeners.add(listener)
      return () => connectedListeners.delete(listener)
    },
  }
}
