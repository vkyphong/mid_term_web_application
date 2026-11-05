// F17 — measure dead-connection detection on the running app (heartbeat 5 s, limit 3 missed beats).
// Alice opens two tabs; tab B goes silent without sending a close frame (network blackhole). Then tab A goes
// silent too. Bob observes /user/queue/presence. Prints a JSON report; accounts are reused between runs.
import os from 'node:os'

const base = process.env.BASE_URL ?? 'http://localhost:8080'
const HEARTBEAT_MS = 5000
const LIMIT_MS = 25000
const RUNS = Number(process.env.RUNS ?? 3)
const log = (...a) => console.error(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function account(email, displayName) {
  const post = (path, body) => fetch(new URL(path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) })
  let res = await post('/api/auth/register', { email, displayName, password: 'Heartbeat123' })
  if (res.status === 409) res = await post('/api/auth/login', { email, password: 'Heartbeat123' })
  const json = await res.json()
  return { id: json.user.id, token: json.accessToken }
}

function socket(user, heartbeat, onEvent) {
  return new Promise((resolve, reject) => {
    const url = new URL('/ws', base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(url, 'v12.stomp')
    const s = { ws, lastSentAt: 0, closedAt: null, beat: null }
    s.send = (text) => { ws.send(text); s.lastSentAt = Date.now() }
    let buffer = ''
    ws.addEventListener('open', () => s.send(`CONNECT\naccept-version:1.2\nhost:${url.hostname}\nAuthorization:Bearer ${user.token}\nheart-beat:${heartbeat}\n\n\0`))
    ws.addEventListener('message', ({ data }) => {
      buffer += String(data)
      let end
      while ((end = buffer.indexOf('\0')) >= 0) {
        const frame = buffer.slice(0, end).replace(/^\n+/, '')
        buffer = buffer.slice(end + 1)
        if (frame.startsWith('CONNECTED')) resolve(s)
        else if (frame.startsWith('ERROR')) reject(new Error(frame))
        else if (frame.startsWith('MESSAGE')) onEvent?.(JSON.parse(frame.slice(frame.indexOf('\n\n') + 2)))
      }
    })
    ws.addEventListener('close', () => { s.closedAt = Date.now(); clearInterval(s.beat) })
  })
}

async function once(alice, bob) {
  const presence = []
  const observer = await socket(bob, '0,0', (e) => e.type === 'presence:update' && presence.push({ at: Date.now(), ...e.payload }))
  observer.send('SUBSCRIBE\nid:p\ndestination:/user/queue/presence\n\n\0')
  const tabA = await socket(alice, `${HEARTBEAT_MS},${HEARTBEAT_MS}`)
  const tabB = await socket(alice, `${HEARTBEAT_MS},${HEARTBEAT_MS}`)
  tabA.beat = setInterval(() => tabA.send('\n'), HEARTBEAT_MS)
  await sleep(300)
  presence.length = 0
  // Tab B im lặng từ đây: không heartbeat, không close.
  const silentB = tabB.lastSentAt
  while (!tabB.closedAt && Date.now() - silentB < 60000) await sleep(100)
  const tabBDetectedMs = tabB.closedAt ? tabB.closedAt - silentB : null
  const aliceOfflineWhileTabALive = presence.some((p) => p.userId === alice.id && p.online === false)
  // Tab A (tab cuối) cũng im lặng → Alice phải offline đúng hạn.
  clearInterval(tabA.beat)
  const silentA = tabA.lastSentAt
  while (!presence.some((p) => p.userId === alice.id && p.online === false) && Date.now() - silentA < 60000) await sleep(100)
  const off = presence.find((p) => p.userId === alice.id && p.online === false)
  observer.ws.close()
  return {
    silentTabClosedAfterMs: tabBDetectedMs,
    aliceStayedOnlineWithOneLiveTab: !aliceOfflineWhileTabALive,
    lastTabOfflineAfterMs: off ? off.at - silentA : null,
    presencePayloadHasLastSeen: Boolean(off?.lastSeen),
  }
}

const alice = await account('heartbeat-alice@dqgm.dev', 'Kiểm thử Heartbeat A')
const bob = await account('heartbeat-bob@dqgm.dev', 'Kiểm thử Heartbeat B')
const runs = []
for (let i = 0; i < RUNS; i++) {
  log(`Run ${i + 1}/${RUNS}`)
  runs.push(await once(alice, bob))
  log(JSON.stringify(runs.at(-1)))
  await sleep(1000)
}
const detected = runs.flatMap((r) => [r.silentTabClosedAfterMs, r.lastTabOfflineAfterMs]).filter((v) => v != null)
console.log(JSON.stringify({
  heartbeatMs: HEARTBEAT_MS, requirementMs: LIMIT_MS, baseUrl: base, client: `${os.type()} node ${process.version}`, at: new Date().toISOString(),
  runs,
  worstDetectionMs: detected.length ? Math.max(...detected) : null,
  pass: runs.every((r) => r.aliceStayedOnlineWithOneLiveTab && r.silentTabClosedAfterMs != null && r.silentTabClosedAfterMs <= LIMIT_MS
    && r.lastTabOfflineAfterMs != null && r.lastTabOfflineAfterMs <= LIMIT_MS),
}, null, 2))
process.exit(0)
