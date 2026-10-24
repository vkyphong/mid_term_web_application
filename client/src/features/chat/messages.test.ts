import { describe, expect, it } from 'vitest'
import { mergeMessages, setPendingStatus, upsertMessage } from './messages'
import type { ChatMessage } from './types'

const msg = (id: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  roomId: 'r1',
  clientMsgId: null,
  sender: { id: 'u1', displayName: 'Đạt' },
  content: id,
  createdAt,
  ...extra,
})

describe('upsertMessage', () => {
  it('giữ hai người gửi dùng cùng clientMsgId', () => {
    const first = msg('a', '2026-10-21T08:00:00Z', { clientMsgId: 'same' })
    const second = msg('b', '2026-10-21T08:00:01Z', { clientMsgId: 'same', sender: { id: 'u2', displayName: 'An' } })
    expect(upsertMessage([first], second).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('xếp đúng timestamp UTC có phần thập phân khác độ dài', () => {
    const list = [msg('a', '2026-10-21T08:00:00.123Z'), msg('b', '2026-10-21T08:00:00.123001Z')]
    expect(mergeMessages([], list).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('xếp theo thời gian rồi id, không trùng id', () => {
    let list = upsertMessage([], msg('b', '2026-10-21T08:00:01Z'))
    list = upsertMessage(list, msg('a', '2026-10-21T08:00:00Z'))
    list = upsertMessage(list, msg('c', '2026-10-21T08:00:01Z'))
    list = upsertMessage(list, msg('a', '2026-10-21T08:00:00Z', { content: 'sửa' }))
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(list[0].content).toBe('sửa')
  })

  it('thay bản tạm bằng tin từ server theo clientMsgId', () => {
    const pending = msg('pending:x', '2026-10-21T09:00:00Z', { clientMsgId: 'x', status: 'sending' })
    let list = upsertMessage([msg('a', '2026-10-21T08:00:00Z')], pending)
    list = upsertMessage(list, msg('srv-1', '2026-10-21T08:30:00Z', { clientMsgId: 'x' }))
    expect(list.map((m) => m.id)).toEqual(['a', 'srv-1'])
    expect(list.every((m) => !m.status)).toBe(true)
  })

  it('ack và message:new cùng một tin chỉ hiện một lần', () => {
    const server = msg('srv-1', '2026-10-21T08:30:00Z', { clientMsgId: 'x' })
    let list = upsertMessage([], msg('pending:x', '2026-10-21T08:30:00Z', { clientMsgId: 'x', status: 'sending' }))
    list = upsertMessage(list, server)
    list = upsertMessage(list, server)
    expect(list).toHaveLength(1)
  })

  it('tin tạm luôn nằm cuối', () => {
    let list = upsertMessage([], msg('pending:x', '2026-10-21T10:00:00Z', { clientMsgId: 'x', status: 'sending' }))
    list = upsertMessage(list, msg('b', '2026-10-21T11:00:00Z'))
    expect(list.map((m) => m.id)).toEqual(['b', 'pending:x'])
  })

  it('không hạ tin đã xác nhận về bản tạm khi retry', () => {
    const list = upsertMessage([], msg('srv-1', '2026-10-21T08:30:00Z', { clientMsgId: 'x' }))
    const after = upsertMessage(list, msg('pending:x', '2026-10-21T08:31:00Z', { clientMsgId: 'x', status: 'sending' }))
    expect(after.map((m) => m.id)).toEqual(['srv-1'])
  })
})

describe('mergeMessages / setPendingStatus', () => {
  it('gộp lịch sử với tin realtime đến trong lúc tải', () => {
    const history = [msg('a', '2026-10-21T08:00:00Z'), msg('b', '2026-10-21T08:01:00Z')]
    const live = [msg('b', '2026-10-21T08:01:00Z'), msg('c', '2026-10-21T08:02:00Z')]
    expect(mergeMessages(history, live).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('đổi trạng thái bản tạm', () => {
    const list = [msg('pending:x', '2026-10-21T08:00:00Z', { clientMsgId: 'x', status: 'sending' })]
    expect(setPendingStatus(list, 'x', 'failed')[0].status).toBe('failed')
  })
})
