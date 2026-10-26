import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { applyPresence, describePresence, presenceKey } from './presence'
import type { Presence } from './types'

const now = Date.parse('2026-10-26T10:00:00Z')

describe('F06 presence', () => {
  it('mô tả trạng thái và lần hoạt động cuối', () => {
    expect(describePresence({ userId: 'a', online: true, lastSeen: null }, now)).toBe('Đang hoạt động')
    expect(describePresence({ userId: 'a', online: false, lastSeen: null }, now)).toBe('Chưa hoạt động')
    expect(describePresence(undefined, now)).toBe('Chưa hoạt động')
    expect(describePresence({ userId: 'a', online: false, lastSeen: '2026-10-26T09:59:30Z' }, now)).toBe('Vừa hoạt động')
    expect(describePresence({ userId: 'a', online: false, lastSeen: '2026-10-26T09:55:00Z' }, now)).toBe('Hoạt động 5 phút trước')
    expect(describePresence({ userId: 'a', online: false, lastSeen: '2026-10-26T07:00:00Z' }, now)).toBe('Hoạt động 3 giờ trước')
    expect(describePresence({ userId: 'a', online: false, lastSeen: '2026-10-24T10:00:00Z' }, now)).toBe('Hoạt động 2 ngày trước')
  })

  it('presence:update thay đúng user trong snapshot, thêm user mới, không tạo bản dư', () => {
    const queryClient = new QueryClient()
    const snapshot: Presence[] = [
      { userId: 'a', online: false, lastSeen: null },
      { userId: 'b', online: true, lastSeen: null },
    ]
    queryClient.setQueryData(presenceKey, snapshot)
    applyPresence(queryClient, { userId: 'a', online: true, lastSeen: null })
    applyPresence(queryClient, { userId: 'a', online: true, lastSeen: null })
    applyPresence(queryClient, { userId: 'c', online: true, lastSeen: null })
    applyPresence(queryClient, { userId: 'b', online: false, lastSeen: '2026-10-26T09:00:00Z' })
    expect(queryClient.getQueryData(presenceKey)).toEqual([
      { userId: 'a', online: true, lastSeen: null },
      { userId: 'b', online: false, lastSeen: '2026-10-26T09:00:00Z' },
      { userId: 'c', online: true, lastSeen: null },
    ])
  })

  it('chưa có snapshot thì bỏ qua (snapshot sẽ được tải lại)', () => {
    const queryClient = new QueryClient()
    applyPresence(queryClient, { userId: 'a', online: true, lastSeen: null })
    expect(queryClient.getQueryData(presenceKey)).toBeUndefined()
  })
})
