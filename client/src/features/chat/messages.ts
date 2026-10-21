import type { ChatMessage } from './types'

const byTimeThenId = (a: ChatMessage, b: ChatMessage) =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.createdAt < b.createdAt ? -1 : 1

/**
 * Thêm hoặc thay một tin, không tạo trùng:
 * - cùng `id` → thay;
 * - cùng `clientMsgId` → thay bản tạm (đang gửi / lỗi) bằng tin từ server.
 * Tin đã xác nhận xếp theo createdAt rồi id; tin tạm luôn ở cuối theo thứ tự gửi.
 */
export function upsertMessage(list: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const next = list.filter(
    (m) => m.id !== incoming.id && !(incoming.clientMsgId && m.clientMsgId === incoming.clientMsgId),
  )
  // Bản tạm đến sau tin đã xác nhận cùng clientMsgId (vd retry khi ack đã tới) → giữ tin thật.
  if (incoming.status) {
    const confirmed = list.find((m) => !m.status && m.clientMsgId && m.clientMsgId === incoming.clientMsgId)
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
