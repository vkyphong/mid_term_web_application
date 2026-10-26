import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiError'
import { chatTransport } from './chatApi'
import { RECEIPT_INTERVAL_MS, describeReceipt, markDelivered, markSeen, needsReceipt, resetReceipts } from './receipts'
import type { ChatMessage } from './types'

vi.mock('./chatApi', () => ({ chatTransport: { request: vi.fn() } }))
const request = vi.mocked(chatTransport.request)

const msg = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, roomId: 'r1', clientMsgId: `c-${id}`, sender: { id: 'phong', displayName: 'Phong' }, content: id,
  createdAt: '2026-10-26T08:00:00Z', receipts: { recipients: 1, delivered: 0, seen: 0 }, ...extra,
})
const sent = () => request.mock.calls.map(([type, p]) => `${type}:${(p as { messageId: string }).messageId}`)
const tick = async (ms = RECEIPT_INTERVAL_MS) => { await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => {
  vi.useFakeTimers()
  resetReceipts()
  request.mockReset().mockImplementation(async (_type, payload) => msg((payload as { messageId: string }).messageId) as never)
})
afterEach(() => vi.useRealTimers())

describe('needsReceipt', () => {
  it('không gửi cho tin của mình, tin tạm, tin đã xoá, hoặc khi mình không thuộc tập người nhận', () => {
    expect(needsReceipt(msg('a', { sender: { id: 'me', displayName: 'Tôi' } }), 'seen', 'me')).toBe(false)
    expect(needsReceipt(msg('a', { status: 'sending' }), 'seen', 'me')).toBe(false)
    expect(needsReceipt(msg('a', { deletedAt: '2026-10-26T09:00:00Z' }), 'seen', 'me')).toBe(false)
    expect(needsReceipt(msg('a', { receipts: { recipients: 0, delivered: 0, seen: 0 } }), 'seen', 'me')).toBe(false)
  })

  it('DM đã xem đủ (người nhận duy nhất là mình) thì không gửi lại sau khi tải lại trang', () => {
    expect(needsReceipt(msg('a', { receipts: { recipients: 1, delivered: 1, seen: 1 } }), 'seen', 'me')).toBe(false)
    expect(needsReceipt(msg('a', { receipts: { recipients: 1, delivered: 1, seen: 0 } }), 'seen', 'me')).toBe(true)
  })
})

describe('hàng đợi receipt (giới hạn 30 thao tác / 5 s của server)', () => {
  it('gửi tuần tự tối đa 1 lệnh / 250 ms: 30 tin → 20 lệnh trong 5 giây đầu', async () => {
    for (let i = 0; i < 30; i++) markSeen(msg(`m${i}`), 'me')
    await tick(5_000 - 1)
    expect(request.mock.calls.length).toBeLessThanOrEqual(20)
    await tick(5_000)
    expect(request).toHaveBeenCalledTimes(30)
  })

  it('không gửi trùng; seen thay delivered đang chờ; delivered sau seen bị bỏ qua', async () => {
    markDelivered(msg('a'), 'me')
    markSeen(msg('a'), 'me')
    markSeen(msg('a'), 'me')
    await tick(1_000)
    markDelivered(msg('a'), 'me')
    markSeen(msg('a'), 'me')
    await tick(1_000)
    expect(sent()).toEqual(['message:seen:a'])
  })

  it('bị rate_limited thì dừng 5 giây rồi gửi lại', async () => {
    request.mockRejectedValueOnce(new ApiError(429, { code: 'rate_limited' }))
    markSeen(msg('a'), 'me')
    await tick()
    expect(request).toHaveBeenCalledTimes(1)
    await tick(4_000)
    expect(request).toHaveBeenCalledTimes(1)
    await tick(1_500)
    expect(sent()).toEqual(['message:seen:a', 'message:seen:a'])
  })

  it('forbidden (không phải người nhận gốc) thì không thử lại', async () => {
    request.mockRejectedValueOnce(new ApiError(403, { code: 'forbidden' }))
    markSeen(msg('a'), 'me')
    await tick(1_000)
    markSeen(msg('a'), 'me')
    await tick(1_000)
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('describeReceipt', () => {
  const own = (r: ChatMessage['receipts']) => msg('x', { sender: { id: 'me', displayName: 'Tôi' }, receipts: r })

  it('DM có đủ 3 trạng thái', () => {
    expect(describeReceipt(own({ recipients: 1, delivered: 0, seen: 0 }), 'dm').label).toBe('Đã gửi')
    expect(describeReceipt(own({ recipients: 1, delivered: 1, seen: 0 }), 'dm').label).toBe('Đã nhận')
    expect(describeReceipt(own({ recipients: 1, delivered: 1, seen: 1 }), 'dm').label).toBe('Đã xem')
  })

  it('kênh đếm trên số người nhận lúc gửi, một người xem không thành "mọi người đã xem"', () => {
    expect(describeReceipt(own({ recipients: 4, delivered: 0, seen: 0 }), 'channel').label).toBe('Đã gửi')
    expect(describeReceipt(own({ recipients: 4, delivered: 2, seen: 0 }), 'channel').label).toBe('Đã nhận 2/4')
    const one = describeReceipt(own({ recipients: 4, delivered: 3, seen: 1 }), 'channel')
    expect(one.label).toBe('Đã xem 1/4')
    expect(one.detail).toBe('Đã nhận 3/4 · Đã xem 1/4')
    expect(describeReceipt(own({ recipients: 0, delivered: 0, seen: 0 }), 'channel').label).toBe('Đã gửi')
  })
})
