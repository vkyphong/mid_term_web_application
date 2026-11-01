import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { tokenStore } from '../../lib/tokenStore'
import { runProtocol } from './runner'
import type { LabEvent, Protocol } from './types'

const workload = { count: 5, intervalMs: 100, payloadBytes: 128, pollMs: 50 }
beforeEach(async () => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); await vi.advanceTimersByTimeAsync(10); tokenStore.set('test-token') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); tokenStore.set(null) })

function fakeServer(options: { corrupt?: boolean; dropDelivery?: boolean } = {}) {
  const events: LabEvent[] = []
  const sent: { at: number; frame: { payload: { id: string; text: string }; correlationId: string } }[] = []
  let sse: ReadableStreamDefaultController<Uint8Array> | undefined
  const waiters: (() => void)[] = []
  const page = (after: number) => ({ events: events.filter((e) => e.sequence > after), nextCursor: events.length, resetRequired: false })
  const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  const emit = (frame: { payload: { id: string; text: string }; correlationId: string }) => {
    const event: LabEvent = { type: 'lab:pong', payload: { ...frame.payload, ...(options.corrupt ? { text: 'bad' } : {}) }, correlationId: frame.correlationId, ts: new Date().toISOString(), sequence: events.length + 1 }
    if (!options.dropDelivery) {
      events.push(event)
      sse?.enqueue(new TextEncoder().encode(`event: lab:pong\ndata: ${JSON.stringify(event)}\n\n`))
      waiters.splice(0).forEach((wake) => wake())
    }
    return event
  }
  const fetchMock = vi.fn(async (input: URL, init: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/ping')) {
      const frame = JSON.parse(init.body as string)
      sent.push({ at: performance.now(), frame })
      // POST resolves immediately; delivery occurs later via the selected path.
      setTimeout(() => emit(frame), 15)
      return response({ type: 'lab:pong', payload: frame.payload })
    }
    if (url.pathname.endsWith('/sse')) {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { sse = controller; controller.enqueue(new TextEncoder().encode(`event: ready\ndata: ${JSON.stringify(page(events.length))}\n\n`)) }, cancel() { sse = undefined } }), { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const after = Number(url.searchParams.get('after'))
    if (url.pathname.endsWith('/long-poll') && after === events.length) {
      await new Promise<void>((resolve, reject) => {
        waiters.push(resolve)
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }
    return response(page(after))
  })
  vi.stubGlobal('fetch', fetchMock)
  class FakeSocket {
    static CLOSING = 2
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor() { setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
    send(data: string) {
      const frame = JSON.parse(data)
      if (frame.type === 'lab:auth') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'lab:ready' }) } as MessageEvent), 0)
      else {
        sent.push({ at: performance.now(), frame })
        setTimeout(() => this.onmessage?.({ data: JSON.stringify(emit(frame)) } as MessageEvent), 15)
      }
    }
    close() { this.readyState = 3; this.onclose?.() }
  }
  vi.stubGlobal('WebSocket', FakeSocket)
  return { sent, fetchMock }
}

it.each<Protocol>(['poll', 'long-poll', 'sse', 'websocket'])('%s sends the same paced workload and ends latency on selected-path pong', async (protocol) => {
  const server = fakeServer()
  const pending = runProtocol(protocol, workload, new AbortController().signal, () => {})
  await vi.advanceTimersByTimeAsync(800)
  const result = await pending
  expect(result.status).toBe('complete')
  expect(result.samples).toHaveLength(5)
  expect(result.samples.every((s) => s.latencyMs >= 15)).toBe(true)
  expect(result.workloadElapsedMs).toBe(500)
  expect(server.sent.map((s) => s.frame.payload.text.length)).toEqual([128, 128, 128, 128, 128])
  server.sent.forEach((s, index) => expect(Math.abs(s.at - server.sent[0].at - index * workload.intervalMs)).toBeLessThanOrEqual(1))
  expect(new Set(server.sent.map((s) => s.frame.correlationId)).size).toBe(5)
  if (protocol === 'websocket') {
    expect(result.metrics.httpRequests).toBe(0)
    expect(result.metrics.wsHandshakeCount).toBe(1)
    expect(result.metrics.wsFrameOverheadBytesEstimate).toBe(60)
    expect(server.fetchMock).not.toHaveBeenCalled()
  } else {
    expect(result.metrics.httpRequests).toBe(server.fetchMock.mock.calls.length)
    expect(result.metrics.httpResponses).toBe(result.metrics.httpRequests)
    expect(result.metrics.requestHeaderBytesEstimate).toBeGreaterThan(0)
  }
})

it('rejects corrupted payload instead of counting POST response as successful delivery', async () => {
  fakeServer({ corrupt: true })
  const pending = runProtocol('poll', workload, new AbortController().signal, () => {})
  await vi.advanceTimersByTimeAsync(800)
  const result = await pending
  expect(result.status).toBe('failed')
  expect(result.samples).toHaveLength(0)
  expect(result.error).toMatch(/khớp payload/)
})

it('cancels a pending long poll and reports partial results honestly', async () => {
  fakeServer({ dropDelivery: true })
  const controller = new AbortController()
  const pending = runProtocol('long-poll', workload, controller.signal, () => {})
  await vi.advanceTimersByTimeAsync(150)
  controller.abort()
  await vi.advanceTimersByTimeAsync(10)
  const result = await pending
  expect(result.status).toBe('cancelled')
  expect(result.samples).toHaveLength(0)
  expect(result.p95Ms).toBeNull()
})
