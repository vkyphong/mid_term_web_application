import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.BASE_URL || 'http://localhost:8080'
const domain = process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0] || 'DQGM.dev'
async function request(path, { method = 'GET', body, cookie, token, origin } = {}) {
  const response = await fetch(new URL(path, base), {
    method, headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }),
      ...(token && { Authorization: `Bearer ${token}` }), ...(origin && { Origin: origin }) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { /* HTML/static is checked separately. */ }
  return { status: response.status, text, json, cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers }
}
function expectStatus(result, status) { assert.equal(result.status, status, `Expected ${status}, got ${result.status}`); return result }
function socket() {
  const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(url, 'v12.stomp')
  const queue = []
  const waiting = []
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true }) })
  const closed = new Promise((resolve) => ws.addEventListener('close', (event) => resolve(event.code), { once: true }))
  ws.addEventListener('message', (event) => { const value = String(event.data); if (value.trim()) { const resolve = waiting.shift(); if (resolve) resolve(value); else queue.push(value) } })
  const next = () => Promise.race([queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiting.push(resolve)),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('STOMP timeout')), 5000); timer.unref() })])
  return { ws, opened, closed, next, send: (frame) => ws.send(`${frame}\0`) }
}

for (const path of ['/', '/login', '/register']) {
  const result = expectStatus(await request(path), 200)
  assert.match(result.text, /<div id="root">/)
  const asset = result.text.match(/src="([^"]+\.js)"/)
  assert.ok(asset, 'Built frontend bundle is missing')
  expectStatus(await request(asset[1]), 200)
}
expectStatus(await request('/api/auth/me'), 401)
expectStatus(await request('/api/auth/logout', { method: 'POST', origin: 'https://evil.example' }), 403)
const email = `smoke-${randomUUID()}@${domain}`
const registered = expectStatus(await request('/api/auth/register', { method: 'POST', body: { email, displayName: 'Smoke Test', password: 'SmokePass123' } }), 201)
assert.match(registered.headers.get('set-cookie'), /HttpOnly/)
assert.match(registered.headers.get('set-cookie'), /SameSite=Strict/)
expectStatus(await request('/api/auth/login', { method: 'POST', body: { email, password: 'incorrect123' } }), 401)
const duplicate = await request('/api/auth/register', { method: 'POST', body: { email, displayName: 'Smoke Test', password: 'SmokePass123' } })
expectStatus(duplicate, 409)
const wrongDomain = await request('/api/auth/register', { method: 'POST', body: { email: 'test@evil.example', displayName: 'Smoke Test', password: 'SmokePass123' } })
expectStatus(wrongDomain, 403)
expectStatus(await request('/api/auth/me', { token: registered.json.accessToken }), 200)

const rotated = await Promise.all([0, 1].map(() => request('/api/auth/refresh', { method: 'POST', cookie: registered.cookie })))
assert.deepEqual(rotated.map((x) => x.status).sort(), [200, 401], 'Refresh must be single-use under MySQL concurrency')
const active = rotated.find((x) => x.status === 200)
assert.notEqual(active.cookie, registered.cookie)

const valid = socket()
const bad = socket()
try {
  await Promise.all([valid.opened, bad.opened])
  valid.send(`CONNECT\naccept-version:1.2\nhost:${new URL(base).hostname}\nAuthorization:Bearer ${active.json.accessToken}\nheart-beat:0,0\n\n`)
  assert.match(await valid.next(), /^CONNECTED/)
  bad.send('CONNECT\naccept-version:1.2\nhost:localhost\nAuthorization:Bearer invalid\n\n')
  assert.match(await bad.next(), /ERROR[\s\S]*unauthorized/)
  valid.send('SUBSCRIBE\nid:probe\ndestination:/user/queue/session\n\n')
  valid.send('SEND\ndestination:/app/session/ping\n\n{}')
  assert.match(await valid.next(), /session:pong/)
  expectStatus(await request('/api/auth/logout', { method: 'POST', cookie: active.cookie }), 204)
  const closed = await Promise.race([valid.closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Logout did not close socket')), 5000); timer.unref() })])
  assert.equal(closed, 1008)
  expectStatus(await request('/api/auth/me', { token: active.json.accessToken }), 401)
  expectStatus(await request('/api/auth/refresh', { method: 'POST', cookie: active.cookie }), 401)
} finally { valid.ws.close(); bad.ws.close() }
console.log('PASS: built SPA routes, domain/duplicate validation, login failure, protected REST, MySQL concurrent refresh rotation, valid/invalid STOMP, private pong, logout closes socket and revokes tokens.')
console.log('Smoke test created one isolated smoke-* user; no existing user or database volume was removed.')
