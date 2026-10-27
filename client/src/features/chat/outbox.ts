import { ApiError } from '../../lib/apiError'
import { chatTransport } from './chatApi'
import { describeChatError } from './errors'
import type { ClientEvents, Message } from './types'

/**
 * F10/F11: hàng đợi gửi tin.
 * - Gửi tuần tự, đúng thứ tự người dùng bấm gửi (kể cả giữa nhiều phòng).
 * - Mất kết nối: giữ trong hàng đợi, gửi bù khi STOMP kết nối lại (sau khi xác thực xong).
 * - Mất ack (ack timeout) khi vẫn còn kết nối: gửi lại với **cùng clientMsgId và payload**;
 *   server trả tin đã lưu, không tạo bản trùng.
 * - rate_limited: chờ 5 s rồi gửi lại (vẫn cùng clientMsgId).
 * - Lỗi nghiệp vụ (forbidden, invalid_payload…): bỏ khỏi hàng đợi, báo lỗi để người dùng thử lại.
 * Hàng đợi nằm trong bộ nhớ của tab; tải lại trang thì các tin chưa gửi bị bỏ.
 */
export type OutboxItem = ClientEvents['message:send']['payload']

export type OutboxState = 'sending' | 'queued' | 'failed'

export interface OutboxSink {
  sent(message: Message): void
  state(item: OutboxItem, state: OutboxState, error?: string): void
}

export const RATE_LIMIT_WAIT_MS = 5_000
export const LOST_ACK_RETRY_MS = 1_000

const queue: OutboxItem[] = []
let busy = false
let waitTimer: ReturnType<typeof setTimeout> | undefined
let sink: OutboxSink | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function setOutboxSink(next: OutboxSink | null) {
  sink = next
}

/** Số tin đang chờ gửi (cho banner "đang chờ kết nối"). */
export function outboxSize(): number {
  return queue.length
}

export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function enqueue(item: OutboxItem) {
  if (queue.some((q) => q.clientMsgId === item.clientMsgId)) return
  queue.push(item)
  notify()
  pump()
}

function wait(ms: number) {
  clearTimeout(waitTimer)
  waitTimer = setTimeout(() => { waitTimer = undefined; pump() }, ms)
}

/** Gửi tin đầu hàng đợi; gọi lại khi có kết nối mới. */
export function pump() {
  if (busy || waitTimer || queue.length === 0) return
  // Trình duyệt báo offline thì xếp hàng luôn, kể cả khi socket cũ chưa kịp bị đóng.
  if (!chatTransport.isConnected() || navigator.onLine === false) {
    for (const item of queue) sink?.state(item, 'queued')
    return // chờ onConnected
  }
  const item = queue[0]
  busy = true
  sink?.state(item, 'sending')
  chatTransport
    .request('message:send', item)
    .then((message) => {
      queue.shift()
      sink?.sent(message)
      notify()
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        sink?.state(item, 'queued', 'Bạn gửi quá nhanh (tối đa 10 tin / 5 giây). Sẽ tự gửi lại.')
        return wait(RATE_LIMIT_WAIT_MS)
      }
      if (err instanceof ApiError && (err.code === 'network_error' || err.code === 'unauthorized')) {
        // Còn kết nối mà mất ack → gửi lại sớm; mất kết nối → chờ onConnected.
        if (chatTransport.isConnected()) return wait(LOST_ACK_RETRY_MS)
        for (const q of queue) sink?.state(q, 'queued')
        return
      }
      queue.shift()
      sink?.state(item, 'failed', describeChatError(err))
      notify()
    })
    .finally(() => {
      busy = false
      pump()
    })
}

/** Dùng khi đăng xuất và trong test. */
export function resetOutbox() {
  queue.length = 0
  busy = false
  clearTimeout(waitTimer)
  waitTimer = undefined
  notify()
}
