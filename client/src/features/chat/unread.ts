import { useSyncExternalStore } from 'react'
import { compareTimestamps } from './messages'
import type { Message, Room } from './types'

/**
 * Số tin chưa đọc theo phòng. BE không có API đếm chưa đọc, nên client lưu mốc "đã đọc" của từng
 * phòng (localStorage, theo user, đồng bộ giữa các tab) và đếm tin của người khác sau mốc đó.
 */

/** Hiển thị tối đa "5+" như yêu cầu. */
export const UNREAD_CAP = 5

export function formatUnread(count: number): string {
  return count >= UNREAD_CAP ? `${UNREAD_CAP}+` : String(count)
}

interface UnreadState {
  /** roomId → mốc đã đọc (ISO). */
  readAt: Record<string, string>
  /** roomId → ID các tin chưa đọc (đếm theo ID nên tin trùng / sự kiện lặp không làm tăng số). */
  unread: Record<string, string[]>
}

const emptyState = (): UnreadState => ({ readAt: {}, unread: {} })
let userId: string | null = null
let state: UnreadState = emptyState()
const listeners = new Set<() => void>()
const storageKey = (id: string) => `pulsechat:unread:${id}`

function read(id: string): UnreadState {
  try {
    const raw = localStorage.getItem(storageKey(id))
    if (raw) return { ...emptyState(), ...(JSON.parse(raw) as UnreadState) }
  } catch {
    /* dữ liệu hỏng hoặc không có localStorage → bắt đầu lại */
  }
  return emptyState()
}

function commit(next: UnreadState) {
  state = next
  if (userId) {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(next))
    } catch {
      /* hết chỗ / chế độ riêng tư: vẫn chạy trong bộ nhớ */
    }
  }
  listeners.forEach((l) => l())
}

function onStorage(e: StorageEvent) {
  if (!userId || e.key !== storageKey(userId)) return
  state = read(userId)
  listeners.forEach((l) => l())
}

/** Gắn với user đang đăng nhập; trả về hàm huỷ. */
export function startUnread(id: string) {
  userId = id
  state = read(id)
  listeners.forEach((l) => l())
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('storage', onStorage)
    userId = null
    state = emptyState()
    listeners.forEach((l) => l())
  }
}

/** Tin mới của người khác ở phòng không đang xem. Trả về true nếu là tin chưa từng đếm. */
export function noteUnread(message: Message): boolean {
  const readAt = state.readAt[message.roomId]
  if (readAt && compareTimestamps(message.createdAt, readAt) <= 0) return false
  const ids = state.unread[message.roomId] ?? []
  if (ids.includes(message.id)) return false
  commit({ ...state, unread: { ...state.unread, [message.roomId]: [...ids, message.id] } })
  return true
}

/** Đang xem phòng → mọi tin tới thời điểm `at` coi như đã đọc. */
export function markRoomRead(roomId: string, at: string = new Date().toISOString()) {
  const prev = state.readAt[roomId]
  const hasUnread = (state.unread[roomId]?.length ?? 0) > 0
  if (!hasUnread && prev && compareTimestamps(prev, at) >= 0) return
  const { [roomId]: _cleared, ...unread } = state.unread
  void _cleared
  commit({ readAt: { ...state.readAt, [roomId]: prev && compareTimestamps(prev, at) > 0 ? prev : at }, unread })
}

/**
 * Sau khi tải danh sách phòng: phòng chưa có mốc (lần đầu dùng tính năng) lấy mốc là tin cuối,
 * tránh bật số cho toàn bộ lịch sử cũ. Trả về các phòng có tin mới hơn mốc cần tải để đếm.
 */
export function roomsToReconcile(rooms: readonly Room[]): Room[] {
  const readAt = { ...state.readAt }
  let changed = false
  const stale: Room[] = []
  for (const room of rooms) {
    if (room.type === 'channel' && !room.joined) continue
    if (!room.lastMessageAt) continue
    const mark = readAt[room.id]
    if (!mark) {
      readAt[room.id] = room.lastMessageAt
      changed = true
    } else if (compareTimestamps(room.lastMessageAt, mark) > 0) {
      stale.push(room)
    }
  }
  if (changed) commit({ ...state, readAt })
  return stale
}

/** Đếm tin của người khác sau mốc đã đọc trong trang tin mới nhất (đủ vì chỉ hiển thị tới 5+). */
export function applyLatestPage(roomId: string, messages: readonly Message[], selfId: string) {
  const mark = state.readAt[roomId]
  const ids = messages
    .filter((m) => m.sender.id !== selfId && !m.deletedAt && (!mark || compareTimestamps(m.createdAt, mark) > 0))
    .map((m) => m.id)
  const merged = [...new Set([...(state.unread[roomId] ?? []), ...ids])]
  if (merged.length === (state.unread[roomId]?.length ?? 0)) return
  commit({ ...state, unread: { ...state.unread, [roomId]: merged } })
}

export function resetUnread() {
  state = emptyState()
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUnreadCount(roomId: string): number {
  return useSyncExternalStore(subscribe, () => state.unread[roomId]?.length ?? 0)
}

/** Tổng số phòng có tin chưa đọc (cho tiêu đề tab). */
export function useUnreadRooms(): number {
  return useSyncExternalStore(subscribe, () => Object.values(state.unread).filter((ids) => ids.length > 0).length)
}
