import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.BASE_URL || 'http://localhost:8080'
const domain = process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0] || 'DQGM.dev'

async function api(path, token, body, expected = 200) {
  const result = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(result.status, expected, `${path}: expected ${expected}, got ${result.status}`)
  return result.json()
}
async function employee(label) {
  const response = await api('/api/auth/register', null, {
    email: `smoke-chat-${randomUUID()}@${domain}`, displayName: `Smoke ${label}`, password: 'Password123',
  }, 201)
  return { id: response.user.id, token: response.accessToken }
}
async function connect(account) {
  const url = new URL('/ws', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(url, 'v12.stomp')
  const frames = [], waiters = []
  let buffer = ''
  ws.addEventListener('message', ({ data }) => {
    buffer += String(data)
    let end
    while ((end = buffer.indexOf('\0')) >= 0) {
      const frame = buffer.slice(0, end).trimStart(); buffer = buffer.slice(end + 1)
      if (frame.trim()) {
        const resolve = waiters.shift()
        if (resolve) resolve(frame)
        else frames.push(frame)
      }
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const nextRaw = () => new Promise((resolve, reject) => {
    if (frames.length) return resolve(frames.shift())
    const timer = setTimeout(() => reject(new Error('Chat STOMP timeout')), 5000)
    waiters.push((frame) => { clearTimeout(timer); resolve(frame) })
  })
  const send = (frame) => ws.send(`${frame}\0`)
  const next = async () => {
    const frame = await nextRaw()
    assert.match(frame, /^MESSAGE/)
    return JSON.parse(frame.slice(frame.indexOf('\n\n') + 2))
  }
  const barrier = async () => {
    send('SEND\ndestination:/app/session/ping\n\n{}')
    assert.equal((await next()).type, 'session:pong')
  }
  send(`CONNECT\naccept-version:1.2\nhost:${url.hostname}\nAuthorization:Bearer ${account.token}\nheart-beat:0,0\n\n`)
  assert.match(await nextRaw(), /^CONNECTED/)
  for (const queue of ['acks', 'events', 'session']) send(`SUBSCRIBE\nid:${queue}\ndestination:/user/queue/${queue}\n\n`)
  await barrier()
  return {
    next, barrier, close: () => ws.close(),
    request: async (destination, type, payload, ok = true) => {
      const correlationId = randomUUID()
      send(`SEND\ndestination:/app/${destination}\ncontent-type:application/json\n\n${JSON.stringify({ type, payload, correlationId, ts: new Date().toISOString() })}`)
      const ack = await next()
      assert.equal(ack.type, 'ack'); assert.equal(ack.payload.correlationId, correlationId); assert.equal(ack.payload.ok, ok)
      return ack.payload
    },
  }
}

const a = await employee('Alice'), b = await employee('Bob'), c = await employee('Carol')
const channel = await api('/api/rooms', a.token, { name: `Smoke-${randomUUID().slice(0, 24)}` }, 201)
const dms = await Promise.all([
  api('/api/dms', a.token, { userId: b.id }), api('/api/dms', b.token, { userId: a.id }),
])
assert.equal(dms[0].id, dms[1].id, 'Concurrent initial MySQL DM creation must return one room')
assert.equal(dms[0].memberCount, 2)
await api(`/api/rooms/${dms[0].id}/messages`, c.token, undefined, 403)
const clients = []
try {
  for (const user of [a, b, c]) clients.push(await connect(user))
  const [sa, sb, sc] = clients
  await sb.request('room.join', 'room:join', { roomId: channel.id })
  const clientMsgId = randomUUID()
  const payload = { roomId: channel.id, content: 'Xin chào từ MySQL', clientMsgId }
  const sent = await sa.request('message.send', 'message:send', payload)
  assert.equal((await api(`/api/rooms/${channel.id}/messages`, b.token)).messages[0].id, sent.data.id)
  for (const socket of [sa, sb]) {
    const event = await socket.next()
    assert.equal(event.payload.id, sent.data.id)
    assert.equal(typeof event.payload.createdAt, 'string', 'STOMP timestamps must be ISO-8601 strings, like REST')
    assert.equal(event.payload.createdAt, sent.data.createdAt)
  }
  await sc.barrier()
  const retried = await sa.request('message.send', 'message:send', payload)
  assert.equal(retried.data.id, sent.data.id)
  await sa.barrier(); await sb.barrier()
  await sb.request('room.leave', 'room:leave', { roomId: channel.id })
  assert.equal((await sb.request('message.send', 'message:send', { ...payload, clientMsgId: randomUUID() }, false)).error.code, 'forbidden')
  await sa.request('message.send', 'message:send', { ...payload, content: 'After leave', clientMsgId: randomUUID() })
  await sa.next(); await sb.barrier(); await sc.barrier()
  await api(`/api/rooms/${channel.id}/messages`, b.token, undefined, 403)
  const recent = await api(`/api/rooms/${channel.id}/messages?limit=1`, a.token)
  assert.ok(recent.nextCursor)
  const older = await api(`/api/rooms/${channel.id}/messages?limit=1&before=${recent.nextCursor}`, a.token)
  assert.equal(older.messages[0].id, sent.data.id)
  assert.equal(older.nextCursor, null)
  const dm = dms[0].id
  assert.equal((await sc.request('room.join', 'room:join', { roomId: dm }, false)).error.code, 'forbidden')
  assert.equal((await sc.request('message.send', 'message:send', { ...payload, roomId: dm }, false)).error.code, 'forbidden')
  const privateAck = await sa.request('message.send', 'message:send', { roomId: dm, content: 'Private message', clientMsgId: randomUUID() })
  for (const socket of [sa, sb]) assert.equal((await socket.next()).payload.id, privateAck.data.id)
  await sc.barrier()
  assert.equal((await api(`/api/rooms/${dm}/messages`, b.token)).messages[0].content, 'Private message')
  console.log('PASS: F03/F04 on MySQL: concurrent initial DM creation, channel membership, commit before ack, retry deduplication, leave, cursor history and three-user DM privacy.')
} finally { for (const socket of clients) socket.close() }
