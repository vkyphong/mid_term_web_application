import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Message, Room } from './types'
import { applyLatestPage, formatUnread, markRoomRead, noteUnread, roomsToReconcile, startUnread } from './unread'

const msg = (id: string, roomId: string, createdAt: string, senderId = 'u2'): Message => ({
  id, roomId, clientMsgId: null, sender: { id: senderId, displayName: 'Phong' }, content: id, createdAt,
})
const room = (id: string, lastMessageAt: string | null): Room => ({
  id, type: 'channel', name: id, description: null, memberCount: 2, joined: true, peer: null, lastMessageAt,
})
const stored = () => JSON.parse(localStorage.getItem('pulsechat:unread:u1') ?? '{}')
const count = (roomId: string) => stored().unread?.[roomId]?.length ?? 0

let stop: () => void
beforeEach(() => {
  localStorage.clear()
  stop = startUnread('u1')
})
afterEach(() => stop())

describe('số tin chưa đọc', () => {
  it('hiển thị 1–4 đúng số, từ 5 trở lên là "5+"', () => {
    expect([1, 4, 5, 12].map(formatUnread)).toEqual(['1', '4', '5+', '5+'])
  })

  it('đếm theo ID: sự kiện lặp không làm tăng số; tin cũ hơn mốc đã đọc không tính', () => {
    markRoomRead('r1', '2026-11-03T08:00:00Z')
    expect(noteUnread(msg('m1', 'r1', '2026-11-03T08:01:00Z'))).toBe(true)
    expect(noteUnread(msg('m1', 'r1', '2026-11-03T08:01:00Z'))).toBe(false)
    expect(noteUnread(msg('m0', 'r1', '2026-11-03T07:59:00Z'))).toBe(false)
    expect(count('r1')).toBe(1)
  })

  it('mở phòng thì về 0 và mốc không lùi lại', () => {
    noteUnread(msg('m1', 'r1', '2026-11-03T08:01:00Z'))
    markRoomRead('r1', '2026-11-03T08:01:00Z')
    expect(count('r1')).toBe(0)
    markRoomRead('r1', '2026-11-03T07:00:00Z')
    expect(stored().readAt.r1).toBe('2026-11-03T08:01:00Z')
  })

  it('mở lại app: phòng mới lấy tin cuối làm mốc; phòng có tin mới hơn mốc thì đếm từ trang mới nhất, bỏ tin của mình', () => {
    expect(roomsToReconcile([room('r1', '2026-11-03T08:00:00Z'), room('r2', null)])).toEqual([])
    const later = room('r1', '2026-11-03T09:00:00Z')
    expect(roomsToReconcile([later])).toEqual([later])
    applyLatestPage('r1', [
      msg('old', 'r1', '2026-11-03T08:00:00Z'),
      msg('a', 'r1', '2026-11-03T08:30:00Z'),
      msg('mine', 'r1', '2026-11-03T08:40:00Z', 'u1'),
      msg('b', 'r1', '2026-11-03T09:00:00Z'),
    ], 'u1')
    expect(stored().unread.r1).toEqual(['a', 'b'])
  })
})
