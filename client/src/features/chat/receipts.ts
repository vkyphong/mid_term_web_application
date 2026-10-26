import { ApiError } from '../../lib/apiError'
import { chatTransport } from './chatApi'
import type { ChatMessage, RoomType } from './types'

/**
 * F08: hàng đợi gửi message:delivered / message:seen.
 * Server cho tối đa 30 thao tác / 5 s / socket (chung với typing, sửa tin…), nên
 * receipt được gửi tuần tự, tối đa 1 lệnh / 250 ms (= 20 / 5 s), và không gửi lại
 * cho tin đã xác nhận. "seen" bao hàm "delivered".
 */
export const RECEIPT_INTERVAL_MS = 250
const RATE_LIMIT_BACKOFF_MS = 5_000

type Kind = 'delivered' | 'seen'
const rank: Record<Kind, number> = { delivered: 1, seen: 2 }

const acked = new Map<string, Kind>() // messageId → mức đã được server xác nhận
const queue = new Map<string, Kind>() // messageId → mức cần gửi
let timer: ReturnType<typeof setTimeout> | undefined
let paused = false

function schedule(delay = RECEIPT_INTERVAL_MS) {
  if (timer || paused || queue.size === 0) return
  timer = setTimeout(flush, delay)
}

function flush() {
  timer = undefined
  const next = queue.entries().next()
  if (next.done) return
  const [messageId, kind] = next.value
  queue.delete(messageId)
  chatTransport
    .request(kind === 'seen' ? 'message:seen' : 'message:delivered', { messageId })
    .then(() => markAcked(messageId, kind))
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        // Tạm dừng TRƯỚC khi xếp lại hàng, nếu không enqueue sẽ lên lịch gửi lại sau 250 ms.
        paused = true
        enqueue(messageId, kind)
        setTimeout(() => { paused = false; schedule() }, RATE_LIMIT_BACKOFF_MS)
      } else if (err instanceof ApiError && (err.code === 'forbidden' || err.code === 'invalid_payload')) {
        // Không phải người nhận gốc (vd vào kênh sau khi tin được gửi) → đừng thử lại.
        markAcked(messageId, 'seen')
      }
      // Lỗi mạng: bỏ qua; tin vẫn được xử lý lại khi hiện trên màn hình sau reconnect.
    })
    .finally(() => schedule())
}

function markAcked(messageId: string, kind: Kind) {
  const current = acked.get(messageId)
  if (!current || rank[kind] > rank[current]) acked.set(messageId, kind)
}

function enqueue(messageId: string, kind: Kind) {
  const done = acked.get(messageId)
  if (done && rank[done] >= rank[kind]) return
  const queued = queue.get(messageId)
  if (queued && rank[queued] >= rank[kind]) return
  queue.set(messageId, kind)
  schedule()
}

/** Có nên gửi receipt cho tin này không: tin của người khác, đã lưu, chưa bị xoá, và chưa đủ người xác nhận. */
export function needsReceipt(message: ChatMessage, kind: Kind, selfId: string): boolean {
  if (message.status || message.deletedAt || message.sender.id === selfId) return false
  const r = message.receipts
  if (!r) return true
  if (r.recipients === 0) return false // mình không thuộc tập người nhận lúc gửi
  return kind === 'seen' ? r.seen < r.recipients : r.delivered < r.recipients
}

export function markDelivered(message: ChatMessage, selfId: string) {
  if (needsReceipt(message, 'delivered', selfId)) enqueue(message.id, 'delivered')
}

export function markSeen(message: ChatMessage, selfId: string) {
  if (needsReceipt(message, 'seen', selfId)) enqueue(message.id, 'seen')
}

/** Dùng cho test và khi đăng xuất. */
export function resetReceipts() {
  clearTimeout(timer)
  timer = undefined
  paused = false
  acked.clear()
  queue.clear()
}

/**
 * Trạng thái hiển thị cho tin của mình.
 * DM: Đã gửi → Đã nhận → Đã xem. Kênh: đếm trên số người nhận lúc gửi,
 * không bao giờ coi là "mọi người đã xem" chỉ vì một người xem.
 */
export function describeReceipt(message: ChatMessage, roomType: RoomType): { label: string; detail: string } {
  const r = message.receipts
  if (!r || r.recipients === 0) return { label: 'Đã gửi', detail: 'Đã lưu trên máy chủ' }
  const detail = `Đã nhận ${r.delivered}/${r.recipients} · Đã xem ${r.seen}/${r.recipients}`
  if (roomType === 'dm') {
    if (r.seen >= r.recipients) return { label: 'Đã xem', detail }
    if (r.delivered >= r.recipients) return { label: 'Đã nhận', detail }
    return { label: 'Đã gửi', detail }
  }
  if (r.seen > 0) return { label: `Đã xem ${r.seen}/${r.recipients}`, detail }
  if (r.delivered > 0) return { label: `Đã nhận ${r.delivered}/${r.recipients}`, detail }
  return { label: 'Đã gửi', detail }
}
