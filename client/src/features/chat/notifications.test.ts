import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { applyNotification, applyNotificationRead, notificationsKey } from './notifications'
import type { Notification, NotificationPage } from './types'
import { fileKind, formatBytes, validateFile } from './uploads'

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
  const file = (size: number, name: string, type = '') => new File([new Uint8Array(size)], name, { type })

  it('đúng biên 100 MB và định dạng', () => {
    // File giả có kích thước tuỳ ý mà không cấp phát 100 MB thật.
    const sized = (size: number, name: string) => Object.defineProperty(new File(['x'], name), 'size', { value: size })
    expect(validateFile(file(5 * 1024 * 1024 + 1, 'a.png', 'image/png'))).toBeNull()
    expect(validateFile(sized(100 * 1024 * 1024, 'a.zip'))).toBeNull()
    expect(validateFile(sized(100 * 1024 * 1024 + 1, 'a.zip'))).toMatch(/vượt quá giới hạn 100 MB/)
    expect(validateFile(file(10, 'a.gif', 'image/gif'))).toMatch(/Chỉ hỗ trợ ảnh JPG\/PNG, PDF/)
    expect(validateFile(file(0, 'a.pdf', 'application/pdf'))).toBe('Tệp rỗng.')
  })

  it('nhận file văn bản, Office và ZIP theo đuôi file (MIME của trình duyệt có thể khác)', () => {
    for (const name of ['bao-cao.docx', 'SO-LIEU.XLSX', 'slide.pptx', 'ghi-chu.txt', 'du-lieu.csv', 'tai-lieu.zip', 'a.jpeg']) {
      expect(validateFile(file(10, name))).toBeNull()
    }
    expect(validateFile(file(10, 'du-lieu.csv', 'application/vnd.ms-excel'))).toBeNull()
    expect(validateFile(file(10, 'macro.docm'))).toMatch(/Chỉ hỗ trợ/)
    expect(validateFile(file(10, 'cu.doc'))).toMatch(/Chỉ hỗ trợ/)
    expect(validateFile(file(10, 'khong-duoi'))).toMatch(/Chỉ hỗ trợ/)
  })

  it('nút gửi ảnh chỉ nhận JPG/PNG', () => {
    expect(validateFile(file(10, 'a.jpg'), true)).toBeNull()
    expect(validateFile(file(10, 'a.pdf'), true)).toBe('Chỉ gửi được ảnh JPG hoặc PNG.')
  })

  it('chọn biểu tượng theo loại file', () => {
    expect(fileKind('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word')
    expect(fileKind('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('excel')
    expect(fileKind('a.csv', 'text/csv')).toBe('excel')
    expect(fileKind('a.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('powerpoint')
    expect(fileKind('a.zip', 'application/zip')).toBe('archive')
    expect(fileKind('a.txt', 'text/plain')).toBe('text')
    expect(fileKind('a.png', 'image/png')).toBe('image')
    expect(fileKind('a.pdf', 'application/pdf')).toBe('pdf')
  })

  it('định dạng kích thước dễ đọc', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })
})
