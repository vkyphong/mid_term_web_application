import { config } from '../../config'
import { toApiError } from '../../lib/apiError'
import { tokenStore } from '../../lib/tokenStore'
import { uuid } from '../../lib/uuid'
import { byteLength, frameOverhead, percentile, requestHeaderEstimate, responseHeaderEstimate, SseParser, validateWorkload } from './measurements'
import type { LabEvent, LabMetrics, LabPage, LabProgress, LabResult, Protocol, Sample, Workload } from './types'

const abortError = () => new DOMException('Đã dừng bài đo.', 'AbortError')
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, Math.max(0, ms))
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function runProtocol(protocol: Protocol, workload: Workload, outerSignal: AbortSignal, progress: (p: LabProgress) => void): Promise<LabResult> {
  const invalid = validateWorkload(workload)
  if (invalid) throw new Error(invalid)
  const token = tokenStore.get()
  if (!token) throw new Error('Vui lòng đăng nhập lại trước khi chạy Lab.')
  const controller = new AbortController()
  const { signal } = controller
  const cancel = () => controller.abort()
  outerSignal.addEventListener('abort', cancel, { once: true })
  if (outerSignal.aborted) cancel()
  const metrics: LabMetrics = { httpRequests: 0, httpResponses: 0, setupHttpRequests: 0, requestHeaderBytesEstimate: 0, responseHeaderBytesEstimate: 0, httpBodyBytesSent: 0, httpBodyBytesReceived: 0, wsHandshakeCount: 0, wsFrameOverheadBytesEstimate: 0, wsPayloadBytesSent: 0, wsPayloadBytesReceived: 0 }
  const samples: Sample[] = []
  const pending = new Map<string, { index: number; at: number; lag: number; frame: string }>()
  const tasks: Promise<unknown>[] = []
  const posts: Promise<unknown>[] = []
  const runId = uuid()
  const startedAt = new Date().toISOString()
  const setupStart = performance.now()
  let start = 0, setupMs = 0, workloadElapsedMs = 0, sent = 0, cursor = 0
  let socket: WebSocket | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let failure: Error | undefined
  let status: LabResult['status'] = 'complete'
  const fail = (error: unknown) => {
    if (!signal.aborted) { failure = error instanceof Error ? error : new Error('Lab transport failed'); controller.abort() }
  }
  const notify = () => progress({ protocol, phase: start ? 'running' : 'setup', sent, received: samples.length })
  const receive = (event: LabEvent) => {
    if (signal.aborted || event.type !== 'lab:pong') return
    const item = pending.get(event.payload?.id)
    if (!item) return // Ignore historical, duplicate, or other-tab pongs.
    const ping = JSON.parse(item.frame)
    if (event.payload.text !== ping.payload.text || event.correlationId !== ping.correlationId) throw new Error('Pong không khớp payload/correlationId đã gửi.')
    samples.push({ index: item.index, latencyMs: performance.now() - item.at, sentAtMs: item.at - start, scheduleLagMs: item.lag })
    pending.delete(event.payload.id)
    notify()
  }
  const page = (p: LabPage, baseline = false) => {
    if (!Array.isArray(p.events) || !Number.isInteger(p.nextCursor)) throw new Error('Invalid Lab page')
    if (p.resetRequired && !baseline) throw new Error('Lịch sử Lab bị tràn hoặc server đã khởi động lại. Hãy chạy lại bài đo.')
    if (!baseline) p.events.forEach(receive)
    cursor = p.nextCursor
  }
  const http = async (path: string, body?: string, setup = false): Promise<Response> => {
    signal.throwIfAborted()
    const url = new URL(path, config.apiBaseUrl || window.location.origin)
    const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: path.includes('/sse?') ? 'text/event-stream' : 'application/json' })
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const bodyBytes = body === undefined ? undefined : byteLength(body)
    metrics.httpRequests++
    if (setup) metrics.setupHttpRequests++
    metrics.requestHeaderBytesEstimate += requestHeaderEstimate(url, body === undefined ? 'GET' : 'POST', headers, bodyBytes)
    metrics.httpBodyBytesSent += bodyBytes ?? 0
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers, body, signal, credentials: 'omit', cache: 'no-store' })
    metrics.httpResponses++
    metrics.responseHeaderBytesEstimate += responseHeaderEstimate(response)
    if (!response.ok) throw await toApiError(response)
    return response
  }
  const json = async (path: string, body?: string, setup = false) => {
    const response = await http(path, body, setup)
    const text = await response.text()
    metrics.httpBodyBytesReceived += byteLength(text)
    return JSON.parse(text)
  }
  // Bound setup, delivery and cleanup even if a transport never responds.
  const deadline = setTimeout(() => { fail(new Error('Bài đo hết thời gian chờ.')) }, workload.count * workload.intervalMs + 20_000)
  try {
    notify()
    if (protocol === 'websocket') {
      const url = new URL('/lab/ws', config.apiBaseUrl || window.location.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      metrics.wsHandshakeCount = 1
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(abortError())
        signal.addEventListener('abort', abort, { once: true })
        socket = new WebSocket(url)
        socket.onopen = () => socket?.send(JSON.stringify({ type: 'lab:auth', payload: { authorization: `Bearer ${token}` }, ts: new Date().toISOString() }))
        socket.onmessage = (message) => {
          try {
            const event = JSON.parse(message.data)
            if (event.type === 'lab:error') throw new Error(`${event.payload?.error?.code ?? 'invalid_payload'}: ${event.payload?.error?.message ?? 'Lab rejected the frame'}`)
            if (event.type === 'lab:ready') { signal.removeEventListener('abort', abort); resolve(); return }
            if (event.type === 'lab:pong') {
              const bytes = byteLength(message.data)
              metrics.wsPayloadBytesReceived += bytes
              metrics.wsFrameOverheadBytesEstimate += frameOverhead(bytes, false)
              receive(event)
            }
          } catch (error) { reject(error); fail(error) }
        }
        socket.onerror = () => { const error = new Error('Không kết nối được raw WebSocket.'); reject(error); fail(error) }
        socket.onclose = () => { if (!signal.aborted && samples.length < workload.count) { const error = new Error('WebSocket đóng trước khi nhận đủ pong.'); reject(error); fail(error) } }
      })
    } else {
      page(await json('/api/lab/poll?after=0', undefined, true), true)
      if (protocol === 'sse') {
        const response = await http(`/api/lab/sse?after=${cursor}`, undefined, true)
        if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Máy chủ không trả về SSE stream.')
        reader = response.body.getReader()
        let ready!: () => void
        const initialized = new Promise<void>((resolve, reject) => {
          ready = resolve
          signal.addEventListener('abort', () => reject(failure ?? abortError()), { once: true })
        })
        const parser = new SseParser((name, data) => {
          const event = JSON.parse(data)
          if (name === 'ready') { page(event, true); ready() }
          if (name === 'lab:pong') receive(event)
        })
        const stream = (async () => {
          const decoder = new TextDecoder()
          while (!signal.aborted) {
            const chunk = await reader!.read()
            if (chunk.done) { if (samples.length < workload.count) throw new Error('SSE đóng trước khi nhận đủ pong.'); break }
            metrics.httpBodyBytesReceived += chunk.value.byteLength
            parser.push(decoder.decode(chunk.value, { stream: true }))
          }
        })().catch(fail)
        tasks.push(stream)
        await initialized
      }
    }
    setupMs = performance.now() - setupStart
    start = performance.now()
    notify()
    if (protocol === 'poll' || protocol === 'long-poll') {
      const receiver = (async () => {
        let nextPoll = start + workload.pollMs
        while (!signal.aborted && samples.length < workload.count) {
          if (protocol === 'poll') {
            await sleep(nextPoll - performance.now(), signal)
            nextPoll += workload.pollMs
            if (nextPoll < performance.now()) nextPoll = performance.now() + workload.pollMs
          }
          page(await json(`/api/lab/${protocol}?after=${cursor}`))
        }
      })().catch(fail)
      tasks.push(receiver)
    }
    for (let index = 0; index < workload.count; index++) {
      const scheduled = start + index * workload.intervalMs
      await sleep(scheduled - performance.now(), signal)
      // A delayed browser tab must not emit a catch-up burst that changes the workload.
      const lag = performance.now() - scheduled
      if (lag >= workload.intervalMs) throw new Error('Trình duyệt không giữ được lịch gửi. Giữ tab ở phía trước hoặc giảm tần suất rồi chạy lại.')
      const id = `${runId}-${String(index).padStart(4, '0')}`
      const frame = JSON.stringify({ type: 'lab:ping', payload: { id, text: 'x'.repeat(workload.payloadBytes) }, ts: new Date().toISOString(), correlationId: id })
      pending.set(id, { index, at: performance.now(), lag, frame })
      sent++
      if (protocol === 'websocket') {
        metrics.wsPayloadBytesSent += byteLength(frame)
        metrics.wsFrameOverheadBytesEstimate += frameOverhead(byteLength(frame), true)
        socket!.send(frame)
      } else {
        // POST's returned pong is deliberately ignored: latency ends on the selected delivery path.
        const post = json('/api/lab/ping', frame).catch(fail)
        posts.push(post)
        tasks.push(post)
      }
      notify()
    }
    await sleep(start + workload.count * workload.intervalMs - performance.now(), signal)
    workloadElapsedMs = performance.now() - start
    while (pending.size) await sleep(10, signal)
    // POST bodies must finish before counters are frozen. Receiver loops stop at the final pong;
    // the persistent SSE stream is cancelled in finally.
    await Promise.all(posts)
    if (protocol !== 'sse') await Promise.all(tasks)
    if (failure) throw failure
  } catch (error) {
    status = outerSignal.aborted ? 'cancelled' : 'failed'
    failure ??= error instanceof Error ? error : new Error('Lab failed')
  } finally {
    clearTimeout(deadline)
    controller.abort()
    outerSignal.removeEventListener('abort', cancel)
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
    await reader?.cancel().catch(() => {})
    await Promise.allSettled(tasks)
  }
  const latencies = samples.map((s) => s.latencyMs)
  return { protocol, status, config: { ...workload }, samples: samples.sort((a, b) => a.index - b.index), metrics: { ...metrics }, startedAt, setupMs, workloadElapsedMs: workloadElapsedMs || (start ? performance.now() - start : 0), totalElapsedMs: performance.now() - setupStart, p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95), maxMs: latencies.length ? Math.max(...latencies) : null, ...(status !== 'complete' ? { error: failure?.message } : {}) }
}
