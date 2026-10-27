import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiError'
import { chatTransport } from './chatApi'
import { LOST_ACK_RETRY_MS, RATE_LIMIT_WAIT_MS, enqueue, outboxSize, pump, resetOutbox, setOutboxSink, type OutboxItem } from './outbox'
import type { Message } from './types'

vi.mock('./chatApi', () => ({ chatTransport: { request: vi.fn(), isConnected: vi.fn() } }))
const request = vi.mocked(chatTransport.request)
const isConnected = vi.mocked(chatTransport.isConnected)

const item = (n: number): OutboxItem => ({ roomId: 'r1', content: `tin ${n}`, clientMsgId: `c${n}` })
const saved = (p: OutboxItem): Message => ({
  id: `srv-${p.clientMsgId}`, roomId: p.roomId, clientMsgId: p.clientMsgId, sender: { id: 'me', displayName: 'Tôi' },
  content: p.content, createdAt: '2026-10-27T08:00:00Z',
})
const sentIds = () => request.mock.calls.map(([, p]) => (p as OutboxItem).clientMsgId)

const sink = { sent: vi.fn(), state: vi.fn() }
let connected = true

beforeEach(() => {
  vi.useFakeTimers()
  resetOutbox()
  connected = true
  isConnected.mockReset().mockImplementation(() => connected)
  request.mockReset().mockImplementation(async (_t, p) => saved(p as OutboxItem) as never)
  sink.sent.mockReset()
  sink.state.mockReset()
  setOutboxSink(sink)
})
afterEach(() => vi.useRealTimers())

describe('F10 hàng đợi gửi tin', () => {
  it('gửi tuần tự đúng thứ tự, mỗi lần một tin', async () => {
    let release!: () => void
    request.mockImplementationOnce((_t, p) => new Promise((r) => { release = () => r(saved(p as OutboxItem) as never) }))
    enqueue(item(1)); enqueue(item(2)); enqueue(item(3))
    expect(sentIds()).toEqual(['c1']) // tin 2 chờ tin 1 có ack
    release()
    await vi.runAllTimersAsync()
    expect(sentIds()).toEqual(['c1', 'c2', 'c3'])
    expect(sink.sent.mock.calls.map(([m]) => m.clientMsgId)).toEqual(['c1', 'c2', 'c3'])
    expect(outboxSize()).toBe(0)
  })

  it('offline: xếp hàng (trạng thái queued), có kết nối lại thì gửi bù đúng thứ tự', async () => {
    connected = false
    enqueue(item(1)); enqueue(item(2))
    expect(request).not.toHaveBeenCalled()
    expect(sink.state).toHaveBeenCalledWith(item(1), 'queued')
    expect(sink.state).toHaveBeenCalledWith(item(2), 'queued')
    connected = true
    pump() // useChatEvents gọi pump() khi onConnected
    await vi.runAllTimersAsync()
    expect(sentIds()).toEqual(['c1', 'c2'])
  })

  it('mất ack khi vẫn còn kết nối: gửi lại với cùng clientMsgId và payload', async () => {
    request.mockRejectedValueOnce(new ApiError(0, { code: 'network_error', message: 'Ack timeout' }))
    enqueue({ ...item(1), mentions: ['u2'] })
    await vi.advanceTimersByTimeAsync(LOST_ACK_RETRY_MS - 1)
    expect(request).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]).toEqual(request.mock.calls[0][1])
    expect(sink.sent).toHaveBeenCalledTimes(1)
  })

  it('mất kết nối giữa chừng: tin đang gửi quay lại hàng đợi, không bị coi là lỗi', async () => {
    request.mockImplementationOnce(async () => { connected = false; throw new ApiError(0, { code: 'network_error', message: 'Connection lost' }) })
    enqueue(item(1))
    await vi.runAllTimersAsync()
    expect(sink.state).toHaveBeenLastCalledWith(item(1), 'queued')
    expect(sink.state).not.toHaveBeenCalledWith(item(1), 'failed', expect.anything())
    connected = true
    pump()
    await vi.runAllTimersAsync()
    expect(sentIds()).toEqual(['c1', 'c1'])
  })

  it('F11 rate_limited: báo cho người dùng, chờ 5 giây rồi gửi lại cùng clientMsgId, giữ thứ tự', async () => {
    request.mockRejectedValueOnce(new ApiError(429, { code: 'rate_limited' }))
    enqueue(item(1)); enqueue(item(2))
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WAIT_MS - 1)
    expect(sentIds()).toEqual(['c1'])
    expect(sink.state).toHaveBeenCalledWith(item(1), 'queued', expect.stringMatching(/quá nhanh/))
    await vi.runAllTimersAsync()
    expect(sentIds()).toEqual(['c1', 'c1', 'c2'])
  })

  it('lỗi nghiệp vụ (forbidden): bỏ khỏi hàng đợi, báo lý do, tin sau vẫn gửi tiếp', async () => {
    request.mockRejectedValueOnce(new ApiError(403, { code: 'forbidden' }))
    enqueue(item(1)); enqueue(item(2))
    await vi.runAllTimersAsync()
    expect(sink.state).toHaveBeenCalledWith(item(1), 'failed', 'Bạn không có quyền trong phòng này.')
    expect(sentIds()).toEqual(['c1', 'c2'])
    expect(outboxSize()).toBe(0)
  })

  it('không xếp trùng cùng clientMsgId', () => {
    connected = false
    enqueue(item(1)); enqueue(item(1))
    expect(outboxSize()).toBe(1)
  })
})
