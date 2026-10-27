import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { applyNotification, applyNotificationRead, notificationsKey } from './notifications'
import type { Notification, NotificationPage } from './types'
import { formatBytes, validateFile } from './uploads'

const n = (id: string, extra: Partial<Notification> = {}): Notification => ({
  id, type: 'mention', roomId: 'r1', messageId: 'm1', content: 'hi', createdAt: '2026-10-27T08:00:00Z', readAt: null, ...extra,
})

function client(page: NotificationPage) {
  const qc = new QueryClient()
  qc.setQueryData(notificationsKey, page)
  return qc
}
const read = (qc: QueryClient) => qc.getQueryData<NotificationPage>(notificationsKey)!

describe('F09 notifications cache', () => {
  it('thông báo mới vào đầu danh sách, tăng số chưa đọc; event trùng (nhiều tab / retry) không đếm hai lần', () => {
    const qc = client({ notifications: [n('a')], nextCursor: null, unreadCount: 1 })
    expect(applyNotification(qc, n('b'))).toBe(true)
    expect(applyNotification(qc, n('b'))).toBe(false)
    expect(read(qc).notifications.map((x) => x.id)).toEqual(['b', 'a'])
    expect(read(qc).unreadCount).toBe(2)
  })

  it('đánh dấu đã đọc (từ tab khác) chỉ trừ một lần', () => {
    const qc = client({ notifications: [n('a'), n('b')], nextCursor: null, unreadCount: 2 })
    applyNotificationRead(qc, 'a', '2026-10-27T09:00:00Z')
    applyNotificationRead(qc, 'a', '2026-10-27T09:00:01Z')
    expect(read(qc).unreadCount).toBe(1)
    expect(read(qc).notifications[0].readAt).toBe('2026-10-27T09:00:00Z')
  })
})

describe('F15 kiểm tra file phía client', () => {
  const file = (size: number, type: string) => new File([new Uint8Array(size)], 'f', { type })

  it('đúng biên 5 MB và định dạng', () => {
    expect(validateFile(file(5 * 1024 * 1024, 'image/png'))).toBeNull()
    expect(validateFile(file(5 * 1024 * 1024 + 1, 'image/png'))).toMatch(/vượt quá giới hạn 5 MB/)
    expect(validateFile(file(10, 'image/gif'))).toMatch(/JPEG, PNG hoặc tệp PDF/)
    expect(validateFile(file(0, 'application/pdf'))).toBe('Tệp rỗng.')
  })

  it('định dạng kích thước dễ đọc', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })
})
