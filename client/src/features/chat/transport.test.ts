import type { Client, IMessage } from '@stomp/stompjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiError'
import { setActiveClient } from '../realtime/realtimeBus'
import { ACK_TIMEOUT_MS, createStompTransport, type ChatTransport } from './transport'

type Handler = (message: IMessage) => void

function fakeClient() {
  const handlers = new Map<string, Handler>()
  const client = {
    subscribe: vi.fn((destination: string, handler: Handler) => {
      handlers.set(destination, handler)
      return { unsubscribe: vi.fn() }
    }),
    publish: vi.fn(),
  }
  const push = (destination: string, body: unknown) =>
    handlers.get(destination)?.({ body: JSON.stringify(body) } as IMessage)
  const lastSent = () => JSON.parse(client.publish.mock.calls[client.publish.mock.calls.length - 1][0].body)
  return { client: client as unknown as Client, raw: client, push, lastSent }
}

let transport: ChatTransport

beforeEach(() => {
  setActiveClient(null)
  transport = createStompTransport()
})

afterEach(() => {
  setActiveClient(null)
  vi.useRealTimers()
})

describe('stomp chat transport', () => {
  it('đăng ký queue acks/events khi kết nối', () => {
    const { client, raw } = fakeClient()
    const connected = vi.fn()
    transport.onConnected(connected)
    setActiveClient(client)
    expect(raw.subscribe).toHaveBeenCalledWith('/user/queue/acks', expect.any(Function))
    expect(raw.subscribe).toHaveBeenCalledWith('/user/queue/events', expect.any(Function))
    expect(connected).toHaveBeenCalledOnce()
  })

  it('gửi envelope { type, payload, ts, correlationId } và nhận ack đúng correlationId', async () => {
    const { client, raw, push, lastSent } = fakeClient()
    setActiveClient(client)
    const promise = transport.request('message:send', { roomId: 'r1', content: 'Chào', clientMsgId: 'c1' })

    expect(raw.publish.mock.calls[0][0].destination).toBe('/app/message.send')
    const sent = lastSent()
    expect(sent).toMatchObject({ type: 'message:send', payload: { roomId: 'r1', content: 'Chào', clientMsgId: 'c1' } })
    expect(typeof sent.ts).toBe('string')

    push('/user/queue/acks', { type: 'ack', payload: { correlationId: 'khác', ok: true, data: 'sai' }, ts: '' })
    push('/user/queue/acks', { type: 'ack', payload: { correlationId: sent.correlationId, ok: true, data: { id: 'm1' } }, ts: '' })
    await expect(promise).resolves.toEqual({ id: 'm1' })
  })

  it('ack lỗi → ApiError theo mã contract', async () => {
    const { client, push, lastSent } = fakeClient()
    setActiveClient(client)
    const promise = transport.request('room:join', { roomId: 'r1' })
    push('/user/queue/acks', {
      type: 'ack',
      payload: { correlationId: lastSent().correlationId, ok: false, error: { code: 'forbidden', message: 'no' } },
      ts: '',
    })
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('không có ack sau 10 giây → network_error', async () => {
    vi.useFakeTimers()
    const { client } = fakeClient()
    setActiveClient(client)
    const promise = transport.request('room:leave', { roomId: 'r1' })
    vi.advanceTimersByTime(ACK_TIMEOUT_MS)
    await expect(promise).rejects.toMatchObject({ code: 'network_error' })
  })

  it('chưa kết nối → từ chối ngay', async () => {
    await expect(transport.request('room:join', { roomId: 'r1' })).rejects.toMatchObject({ code: 'network_error' })
  })

  it('mất kết nối → huỷ các request đang chờ', async () => {
    const { client } = fakeClient()
    setActiveClient(client)
    const promise = transport.request('room:join', { roomId: 'r1' })
    setActiveClient(null)
    await expect(promise).rejects.toMatchObject({ code: 'network_error' })
  })

  it('chuyển message:new tới listener, bỏ qua body hỏng', () => {
    const { client, push } = fakeClient()
    const listener = vi.fn()
    transport.onEvent(listener)
    setActiveClient(client)
    push('/user/queue/events', { type: 'message:new', payload: { id: 'm1' }, ts: 't' })
    push('/user/queue/events', { type: 'lạ', payload: {}, ts: 't' })
    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0]).toMatchObject({ type: 'message:new', payload: { id: 'm1' } })
  })
})
