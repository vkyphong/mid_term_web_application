import type { ChatMessage } from './types'

// Server UTC instants may omit trailing fractional zeros; keep microsecond ordering.
export function compareTimestamps(a: string, b: string): number {
  const key = (value: string) => value.replace(/(?:\.(\d+))?Z$/, (_, fraction: string = '') => `.${fraction.padEnd(9, '0')}Z`)
  const left = key(a), right = key(b)
  return left < right ? -1 : left > right ? 1 : 0
}

const byTimeThenId = (a: ChatMessage, b: ChatMessage) =>
  compareTimestamps(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Thêm hoặc thay một tin, không tạo trùng:
 * - cùng `id` → thay;
 * - cùng `clientMsgId` → thay bản tạm (đang gửi / lỗi) bằng tin từ server.
 * Tin đã xác nhận xếp theo createdAt rồi id; tin tạm luôn ở cuối theo thứ tự gửi.
 */
export function upsertMessage(list: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const next = list.filter(
    (m) => m.id !== incoming.id && !(incoming.clientMsgId && m.clientMsgId === incoming.clientMsgId && m.sender.id === incoming.sender.id),
  )
  // Bản tạm đến sau tin đã xác nhận cùng clientMsgId (vd retry khi ack đã tới) → giữ tin thật.
  if (incoming.status) {
    const confirmed = list.find((m) => !m.status && m.clientMsgId && m.clientMsgId === incoming.clientMsgId && m.sender.id === incoming.sender.id)
    if (confirmed) return [...list]
  }
  next.push(incoming)
  const confirmed = next.filter((m) => !m.status).sort(byTimeThenId)
  const pending = next.filter((m) => m.status)
  return [...confirmed, ...pending]
}

export function mergeMessages(list: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  return incoming.reduce<ChatMessage[]>((acc, m) => upsertMessage(acc, m), [...list])
}

/**
 * Gộp trang tin mới nhất (lần tải đầu hoặc tải lại sau reconnect) với cache hiện có.
 * - Trang nối liền với cache → giữ cả tin cũ đã tải thêm (cursor cũ vẫn đúng).
 * - Trang không nối liền (lỡ quá 1 trang khi offline) → bỏ tin cũ để không có khoảng trống,
 *   chỉ giữ tin tạm; `resetCursor` báo phải dùng cursor của trang mới.
 */
export function reconcileLatestPage(
  current: readonly ChatMessage[],
  page: { messages: readonly ChatMessage[]; nextCursor: string | null },
): { messages: ChatMessage[]; resetCursor: boolean } {
  const confirmed = current.filter((m) => !m.status)
  const pending = current.filter((m) => m.status)
  if (confirmed.length === 0) return { messages: mergeMessages(page.messages, current), resetCursor: true }

  const newestKnown = confirmed[confirmed.length - 1]
  const oldestInPage = page.messages[0]
  const gap =
    page.nextCursor !== null &&
    oldestInPage !== undefined &&
    !page.messages.some((m) => m.id === newestKnown.id) &&
    byTimeThenId(oldestInPage, newestKnown) > 0
  if (gap) return { messages: mergeMessages(page.messages, pending), resetCursor: true }
  return { messages: mergeMessages(page.messages, current), resetCursor: false }
}

export function setPendingStatus(
  list: readonly ChatMessage[],
  clientMsgId: string,
  status: 'sending' | 'failed',
): ChatMessage[] {
  return list.map((m) => (m.status && m.clientMsgId === clientMsgId ? { ...m, status } : m))
}

export const MAX_CONTENT_BYTES = 2048

export function contentBytes(content: string): number {
  return new TextEncoder().encode(content).length
}
