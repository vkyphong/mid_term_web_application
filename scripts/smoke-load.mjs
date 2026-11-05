// F18 — load test for STOMP over WebSocket on a single Spring Boot instance.
// Phases: ramp-up → steady (valid traffic, latency) → spam (rate limit) → recovery.
// Accounts (load-NNN@dqgm.dev) and rooms ("Kiểm thử tải NN") are reused between runs so the
// database does not grow. Prints one JSON report to stdout; progress goes to stderr.
//
// Env: BASE_URL (default http://localhost:8080), CONNECTIONS (500), RAMP_SECONDS (30), STEADY_SECONDS (60),
//      PER_USER (4, server limit is 5), ROOM_SIZE (10 users), ADMIN_EMAIL / ADMIN_PASSWORD (demo admin).
import { randomUUID } from 'node:crypto'
import os from 'node:os'

const base = process.env.BASE_URL ?? 'http://localhost:8080'
const N = Number(process.env.CONNECTIONS ?? 500)
const RAMP_S = Number(process.env.RAMP_SECONDS ?? 30)
const STEADY_S = Number(process.env.STEADY_SECONDS ?? 60)
const PER_USER = Math.min(4, Number(process.env.PER_USER ?? 4))
const ROOM_SIZE = Number(process.env.ROOM_SIZE ?? 10)
const HEARTBEAT_MS = 5000
const PASSWORD = 'LoadTest123'
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@dqgm.dev'
const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin123456'
const log = (...args) => console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pct = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
const summary = (values) => ({ samples: values.length, p50: pct(values, 50), p95: pct(values, 95), p99: pct(values, 99), max: values.length ? Math.max(...values) : null })

async function http(path, { token, body, method } = {}) {
  const res = await fetch(new URL(path, base), {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Origin: base, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

/** Đăng ký nếu chưa có, ngược lại đăng nhập (chạy lại không tạo thêm tài khoản). */
async function account(i) {
  const email = `load-${String(i).padStart(3, '0')}@dqgm.dev`
  let res = await http('/api/auth/register', { body: { email, displayName: `Tải thử ${String(i).padStart(3, '0')}`, password: PASSWORD } })
  if (res.status === 409) res = await http('/api/auth/login', { body: { email, password: PASSWORD } })
  if (res.status !== 200 && res.status !== 201) throw new Error(`account ${email}: HTTP ${res.status}`)
  return { id: res.json.user.id, token: res.json.accessToken, email }
}

async function inBatches(items, size, fn) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

/** Phòng dùng lại theo tên; chủ phòng là người đầu nhóm, các thành viên còn lại được thêm qua REST. */
async function room(index, members) {
  const owner = members[0]
  const name = `Kiểm thử tải ${String(index + 1).padStart(2, '0')}`
  const mine = (await http('/api/rooms', { token: owner.token })).json.rooms
  let found = mine.find((r) => r.name === name)
  if (!found) {
    const created = await http('/api/rooms', { token: owner.token, body: { name, description: 'Phòng dùng cho kiểm thử tải F18' } })
    if (created.status !== 201) throw new Error(`room ${name}: HTTP ${created.status}`)
    found = created.json
  }
  for (const m of members.slice(1)) {
    const added = await http(`/api/rooms/${found.id}/members`, { token: owner.token, body: { userId: m.id } })
    if (added.status !== 200 && added.status !== 202) throw new Error(`add member to ${name}: HTTP ${added.status}`)
  }
  return { id: found.id, name, members }
}

/** Một kết nối STOMP; gửi heartbeat 5 s như client thật (server đóng kết nối im lặng ~15 s). */
function connect(user, stats) {
  return new Promise((resolve) => {
    const url = new URL('/ws', base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const started = performance.now()
    const conn = { user, ws: new WebSocket(url, 'v12.stomp'), acks: new Map(), onEvent: null, closed: false }
    let buffer = ''
    let settled = false
    const done = (ok, reason) => {
      if (settled) return
      settled = true
      if (ok) stats.connectMs.push(performance.now() - started)
      else stats.connectErrors[reason] = (stats.connectErrors[reason] ?? 0) + 1
      resolve(ok ? conn : null)
    }
    const send = (text) => { if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(text) }
    conn.send = send
    conn.ws.addEventListener('open', () => {
      send(`CONNECT\naccept-version:1.2\nhost:${url.hostname}\nAuthorization:Bearer ${user.token}\nheart-beat:${HEARTBEAT_MS},${HEARTBEAT_MS}\n\n\0`)
    })
    conn.ws.addEventListener('message', ({ data }) => {
      buffer += String(data)
      let end
      while ((end = buffer.indexOf('\0')) >= 0) {
        const frame = buffer.slice(0, end).replace(/^\n+/, '')
        buffer = buffer.slice(end + 1)
        if (!frame) continue
        if (frame.startsWith('CONNECTED')) {
          for (const q of ['acks', 'events']) send(`SUBSCRIBE\nid:${q}\ndestination:/user/queue/${q}\n\n\0`)
          conn.beat = setInterval(() => send('\n'), HEARTBEAT_MS)
          done(true)
        } else if (frame.startsWith('ERROR')) {
          done(false, /rate_limited|connection_limit/.test(frame) ? 'connection_limit' : 'stomp_error')
        } else if (frame.startsWith('MESSAGE')) {
          const body = JSON.parse(frame.slice(frame.indexOf('\n\n') + 2))
          if (body.type === 'ack') {
            const waiter = conn.acks.get(body.payload.correlationId)
            if (waiter) { conn.acks.delete(body.payload.correlationId); waiter(body.payload) }
          } else conn.onEvent?.(body)
        }
      }
    })
    conn.ws.addEventListener('close', () => { conn.closed = true; clearInterval(conn.beat); done(false, 'closed') })
    conn.ws.addEventListener('error', () => done(false, 'socket_error'))
    setTimeout(() => done(false, 'timeout'), 15000)
  })
}

function sendMessage(conn, roomId, content) {
  const correlationId = randomUUID()
  const ack = new Promise((resolve) => {
    conn.acks.set(correlationId, resolve)
    setTimeout(() => { if (conn.acks.delete(correlationId)) resolve({ ok: false, error: { code: 'timeout' } }) }, 10000)
  })
  conn.send(`SEND\ndestination:/app/message.send\ncontent-type:application/json\n\n${JSON.stringify({
    type: 'message:send', correlationId, ts: new Date().toISOString(), payload: { roomId, content, clientMsgId: randomUUID() },
  })}\0`)
  return ack
}

async function adminStats(token) {
  const res = await http('/api/admin/stats', { token })
  return res.status === 200 ? res.json : null
}

async function main() {
  const report = {
    target: { connections: N, perUser: PER_USER, roomSize: ROOM_SIZE, rampSeconds: RAMP_S, steadySeconds: STEADY_S, heartbeatMs: HEARTBEAT_MS, baseUrl: base },
    client: { node: process.version, platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1) },
    startedAt: new Date().toISOString(),
  }
  const admin = await http('/api/auth/login', { body: { email: adminEmail, password: adminPassword } })
  const adminToken = admin.status === 200 ? admin.json.accessToken : null
  if (!adminToken) log('Admin login failed — server-side stats will be missing')
  const baseline = adminToken ? (await adminStats(adminToken))?.connections ?? 0 : 0

  // ---- Seed ----
  const users = Math.ceil(N / PER_USER)
  log(`Seeding ${users} accounts and ${Math.ceil(users / ROOM_SIZE)} rooms…`)
  const accounts = await inBatches([...Array(users).keys()].map((i) => i + 1), 8, account)
  const groups = []
  for (let i = 0; i < accounts.length; i += ROOM_SIZE) groups.push(accounts.slice(i, i + ROOM_SIZE))
  const rooms = await inBatches(groups.map((g, i) => [i, g]), 4, ([i, g]) => room(i, g))

  // ---- Ramp-up ----
  const stats = { connectMs: [], connectErrors: {} }
  const conns = []
  const plan = []
  for (let k = 0; k < PER_USER; k++) for (const a of accounts) if (plan.length < N) plan.push(a)
  const gap = (RAMP_S * 1000) / N
  log(`Ramp-up: ${N} connections over ${RAMP_S}s`)
  const t0 = performance.now()
  const pending = plan.map((user, i) => sleep(i * gap).then(() => connect(user, stats)).then((c) => c && conns.push(c)))
  await Promise.all(pending)
  report.rampUp = {
    seconds: +((performance.now() - t0) / 1000).toFixed(1), attempted: N, connected: conns.length,
    successRate: +(conns.length / N).toFixed(4), errors: stats.connectErrors, connectMs: summary(stats.connectMs.map(Math.round)),
  }
  log(`Connected ${conns.length}/${N}`)
  await sleep(2000)
  report.serverAfterRamp = adminToken ? await adminStats(adminToken) : null

  // ---- Steady: one sender per room, 1 message / second, latency to every other member connection ----
  const byUser = new Map()
  for (const c of conns) (byUser.get(c.user.id) ?? byUser.set(c.user.id, []).get(c.user.id)).push(c)
  const latency = []
  const ackMs = []
  let delivered = 0
  let sent = 0
  let sendErrors = 0
  const run = randomUUID().slice(0, 8)
  for (const c of conns) {
    c.onEvent = (event) => {
      if (event.type !== 'message:new') return
      const m = /^load (\w+) (\d+(?:\.\d+)?)$/.exec(event.payload.content ?? '')
      if (!m || m[1] !== run) return
      delivered++
      if (event.payload.sender.id !== c.user.id) latency.push(Date.now() - Number(m[2]))
    }
  }
  const senders = rooms.map((r) => ({ room: r, conn: (byUser.get(r.members[0].id) ?? [])[0] })).filter((s) => s.conn)
  log(`Steady: ${senders.length} rooms × 1 msg/s for ${STEADY_S}s`)
  const serverSamples = []
  const steadyEnd = Date.now() + STEADY_S * 1000
  const sampler = (async () => {
    while (Date.now() < steadyEnd) {
      if (adminToken) { const s = await adminStats(adminToken); if (s) serverSamples.push({ at: new Date().toISOString(), ...s }) }
      await sleep(5000)
    }
  })()
  await Promise.all(senders.map(async ({ room: r, conn }, idx) => {
    await sleep((idx * 1000) / senders.length) // dàn đều trong mỗi giây
    while (Date.now() < steadyEnd) {
      const t = performance.now()
      const ack = await sendMessage(conn, r.id, `load ${run} ${Date.now()}`)
      sent++
      if (ack.ok) ackMs.push(performance.now() - t)
      else sendErrors++
      await sleep(Math.max(0, 1000 - (performance.now() - t)))
    }
  }))
  await sampler
  await sleep(3000) // chờ các tin cuối tới nơi
  // Mỗi tin tới mọi kết nối của mọi thành viên phòng (kể cả các tab của người gửi).
  const expectedPerMessage = (s) => s.room.members.reduce((n, m) => n + (byUser.get(m.id)?.length ?? 0), 0)
  const expected = senders.reduce((n, s) => n + expectedPerMessage(s), 0) * (sent / Math.max(1, senders.length))
  report.steady = {
    rooms: senders.length, messagesSent: sent, sendErrors, ackMs: summary(ackMs.map(Math.round)),
    deliveries: delivered, expectedDeliveries: Math.round(expected), deliveryRate: +(delivered / Math.max(1, expected)).toFixed(4),
    deliveryLatencyMs: summary(latency), server: serverSamples,
  }
  log(`Steady done: sent ${sent}, delivered ${delivered}, p95 ${report.steady.deliveryLatencyMs.p95} ms`)

  // ---- Spam: one socket bursts 30 messages; server allows 10 / 5 s per socket ----
  const spammer = senders[0]
  if (spammer) {
    const acks = await Promise.all(Array.from({ length: 30 }, (_, i) => sendMessage(spammer.conn, spammer.room.id, `spam ${run} ${i}`)))
    const codes = {}
    for (const a of acks) { const k = a.ok ? 'ok' : a.error?.code ?? 'unknown'; codes[k] = (codes[k] ?? 0) + 1 }
    // Lưu lượng hợp lệ của phòng khác vẫn chạy bình thường ngay sau đó.
    const other = senders[1]
    const t = performance.now()
    const probe = other ? await sendMessage(other.conn, other.room.id, `load ${run} ${Date.now()}`) : null
    report.spam = { burst: 30, results: codes, otherRoomAckOk: probe?.ok ?? null, otherRoomAckMs: probe ? Math.round(performance.now() - t) : null }
    log('Spam:', JSON.stringify(codes))
  }

  // ---- Recovery ----
  const closeAt = performance.now()
  for (const c of conns) { clearInterval(c.beat); c.ws.close() }
  let recovered = null
  if (adminToken) {
    for (let i = 0; i < 60; i++) {
      const s = await adminStats(adminToken)
      if (s && s.connections <= baseline) { recovered = { seconds: +((performance.now() - closeAt) / 1000).toFixed(1), connections: s.connections, baseline }; break }
      await sleep(500)
    }
  }
  report.recovery = recovered ?? { seconds: null, note: 'did not return to baseline within 30 s or admin stats unavailable', baseline }
  report.finishedAt = new Date().toISOString()
  console.log(JSON.stringify(report, null, 2))
  setTimeout(() => process.exit(0), 500)
}

main().catch((err) => { console.error(err); process.exit(1) })
