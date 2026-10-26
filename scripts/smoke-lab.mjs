import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'

const base = new URL(process.env.BASE_URL ?? 'http://localhost:8080')
assert.equal(base.protocol, 'http:', 'This local benchmark counts HTTP/1.1 bytes and excludes TLS; use an HTTP Docker URL')
const count = 20, intervalMs = 250, pollMs = 100
const domain = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'DQGM.dev').split(',')[0]
function collector() {
  const items = [], waiters = []
  return {
    push: item => waiters.length ? waiters.shift()(item) : items.push(item),
    next: () => items.length ? Promise.resolve(items.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for lab event')), 5000)
      waiters.push(item => { clearTimeout(timer); resolve(item) })
    }),
  }
}
function requester(token, metrics) {
  return (path, body, stream) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body)
    const headers = { Authorization: `Bearer ${token}`, Connection: 'keep-alive' }
    if (data !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const req = http.request(new URL(path, base), { method: data === undefined ? 'GET' : 'POST', headers }, res => {
      metrics.httpRequests++
      // Estimate from explicitly sent headers plus Host; response uses actual raw header pairs.
      metrics.httpHeaderBytesEstimate += Buffer.byteLength(`${req.method} ${req.path} HTTP/1.1\r\nHost: ${base.host}\r\n` + Object.entries(headers).map(([k,v]) => `${k}: ${v}\r\n`).join('') + '\r\n')
      metrics.httpHeaderBytesEstimate += Buffer.byteLength(`HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n` + res.rawHeaders.reduce((s,v,i,a) => i % 2 ? s : s + `${v}: ${a[i+1]}\r\n`, '') + '\r\n')
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Lab HTTP ${res.statusCode}`)); return }
      if (stream) { stream(res); resolve(res); return }
      let text = ''; res.setEncoding('utf8'); res.on('data', x => { text += x }); res.on('end', () => { try { resolve(JSON.parse(text)) } catch(e) { reject(e) } })
    })
    req.setTimeout(30000, () => req.destroy(new Error('HTTP timeout')))
    req.on('error', reject); req.end(data)
  })
}
for (const protocol of ['poll', 'long-poll', 'sse', 'websocket']) {
  const registered = await fetch(new URL('/api/auth/register', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `lab-${randomUUID()}@${domain}`, displayName: 'Lab Smoke', password: 'LabPassword123' }) })
  assert.equal(registered.status, 201)
  const { accessToken } = await registered.json()
  const metrics = { protocol, samples: count, intervalMs, payloadTextBytes: 128, httpRequests: 0, httpHeaderBytesEstimate: 0, wsFrameOverheadBytesEstimate: 0, wsHandshake: protocol === 'websocket' ? 'one upgrade, excluded from HTTP byte estimate' : 'not applicable' }
  const request = requester(accessToken, metrics), queue = collector(), timings = []
  let cursor = 0, resource, buffer = ''
  if (protocol === 'sse') {
    resource = await request('/api/lab/sse', undefined, res => {
      res.setEncoding('utf8'); res.on('data', chunk => {
        buffer += chunk.replaceAll('\r\n', '\n'); let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0,end); buffer = buffer.slice(end+2)
          const data = frame.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5)).join('\n')
          if (data) queue.push(JSON.parse(data))
        }
      })
    })
    assert.ok((await queue.next()).events)
  }
  if (protocol === 'websocket') {
    resource = new WebSocket(new URL('/lab/ws', base).href.replace('http:', 'ws:'))
    resource.addEventListener('message', e => queue.push(JSON.parse(e.data)))
    await new Promise((resolve,reject) => { resource.addEventListener('open',resolve,{once:true}); resource.addEventListener('error',reject,{once:true}) })
    resource.send(JSON.stringify({ type: 'lab:auth', payload: { authorization: `Bearer ${accessToken}` } }))
    assert.equal((await queue.next()).type, 'lab:ready')
  }
  try {
    for (let i=0;i<count;i++) {
      const frame = { type: 'lab:ping', payload: { id: String(i), text: 'x'.repeat(128) }, ts: new Date().toISOString() }
      const started = performance.now()
      let delivered
      if (protocol === 'websocket') {
        resource.send(JSON.stringify(frame)); delivered = await queue.next()
        // One masked client frame and one unmasked server frame; extended 16-bit lengths where needed.
        metrics.wsFrameOverheadBytesEstimate += 6 + (Buffer.byteLength(JSON.stringify(frame)) >=126 ? 2 : 0) + 2 + (Buffer.byteLength(JSON.stringify(delivered)) >=126 ? 2 : 0)
      } else {
        const receive = protocol === 'sse' ? queue.next() : protocol === 'long-poll'
          ? request(`/api/lab/long-poll?after=${cursor}`).then(page => page.events[0])
          : (async () => { for (;;) { await sleep(pollMs); const page = await request(`/api/lab/poll?after=${cursor}`); if (page.events.length) return page.events[0] } })()
        await request('/api/lab/ping', frame)
        delivered = await receive
      }
      assert.equal(delivered.type, 'lab:pong'); assert.deepEqual(delivered.payload, frame.payload)
      cursor = delivered.sequence; timings.push(performance.now()-started)
      await sleep(Math.max(0, intervalMs-(performance.now()-started)))
    }
  } finally { protocol === 'websocket' ? resource?.close() : resource?.destroy() }
  timings.sort((a,b)=>a-b)
  console.log(JSON.stringify({ ...metrics, p50Ms: +timings[Math.ceil(count*.5)-1].toFixed(2), p95Ms: +timings[Math.ceil(count*.95)-1].toFixed(2), maxMs: +timings.at(-1).toFixed(2) }))
}
console.log('F13 all four transports passed. Header values are estimates; TLS, TCP/IP, chunk framing and WS handshake bytes excluded. Auth setup excluded. No browser/UI measurement.')
