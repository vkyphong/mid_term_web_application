import type { QueryClient } from '@tanstack/react-query'
import { compareTimestamps } from './messages'
import type { Message, Room } from './types'

/** Số chưa đọc lấy từ server; client chỉ cộng khi có tin mới và về 0 khi đang xem phòng. */

/** Hiển thị tối đa "5+" như Zalo. */
export const UNREAD_CAP = 5

export function formatUnread(count: number): string {
  return count >= UNREAD_CAP ? `${UNREAD_CAP}+` : String(count)
}

const ROOMS_KEY = ['chat', 'rooms'] as const
/** ID tin đã cộng, để sự kiện lặp không làm tăng số. */
const counted = new Set<string>()
/** roomId → lastMessageAt lúc mình đang xem phòng (giờ server). */
const viewedUpTo = new Map<string, string>()

function setRoom(queryClient: QueryClient, roomId: string, update: (room: Room) => Room) {
  queryClient.setQueryData<Room[]>(ROOMS_KEY, (rooms) => rooms?.map((r) => (r.id === roomId ? update(r) : r)))
}

/** Tin mới của người khác ở phòng không đang xem. Trả về true nếu là tin chưa từng đếm. */
export function bumpUnread(queryClient: QueryClient, message: Message): boolean {
  if (counted.has(message.id)) return false
  counted.add(message.id)
  setRoom(queryClient, message.roomId, (r) => ({ ...r, unreadCount: (r.unreadCount ?? 0) + 1 }))
  return true
}

/** Nhớ mốc đã xem để lần tải lại kế tiếp không hiện lại số cũ. */
export function markViewed(queryClient: QueryClient, roomId: string, lastMessageAt: string | null) {
  if (lastMessageAt) {
    const prev = viewedUpTo.get(roomId)
    if (!prev || compareTimestamps(prev, lastMessageAt) < 0) viewedUpTo.set(roomId, lastMessageAt)
  }
  setRoom(queryClient, roomId, (r) => (r.unreadCount ? { ...r, unreadCount: 0 } : r))
}

/** Áp lên danh sách phòng vừa tải: phòng chưa có tin mới kể từ lúc xem thì không còn chưa đọc. */
export function withViewed(rooms: Room[]): Room[] {
  return rooms.map((r) => {
    const viewed = viewedUpTo.get(r.id)
    const stale = viewed && r.unreadCount && (!r.lastMessageAt || compareTimestamps(r.lastMessageAt, viewed) <= 0)
    return stale ? { ...r, unreadCount: 0 } : r
  })
}

export function resetUnread() {
  counted.clear()
  viewedUpTo.clear()
}

/** Số phòng có tin chưa đọc (cho tiêu đề tab). */
export function countUnreadRooms(rooms: readonly Room[] | undefined): number {
  return rooms?.filter((r) => (r.unreadCount ?? 0) > 0).length ?? 0
}
