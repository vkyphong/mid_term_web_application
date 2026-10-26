import { test, expect, type Browser, type Page } from '@playwright/test'

interface Account { id: string; email: string; displayName: string; token: string }
interface Capture {
  events: { type: string; payload: { roomId?: string; content?: string } }[]
  sent: Map<string, number>
  received: Map<string, number>
}

function capture(page: Page): Capture {
  const state: Capture = { events: [], sent: new Map(), received: new Map() }
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const raw = payload.toString()
      const start = raw.indexOf('\n\n')
      if (!raw.startsWith('SEND') || start < 0) return
      try {
        const body = JSON.parse(raw.slice(start + 2).replace(/\0/g, ''))
        if (body.type === 'message:send') state.sent.set(body.payload.content, performance.now())
      } catch { /* Ignore heartbeat and protocol frames. */ }
    })
    socket.on('framereceived', ({ payload }) => {
      for (const raw of payload.toString().split('\0')) {
        const start = raw.indexOf('\n\n')
        if (start < 0) continue
        try {
          const body = JSON.parse(raw.slice(start + 2))
          if (body.type === 'message:new') {
            state.events.push(body)
            state.received.set(body.payload.content, performance.now())
          }
        } catch { /* Ignore heartbeat and protocol frames. */ }
      }
    })
  })
  return state
}

async function employee(browser: Browser, label: string) {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const email = `e2e-${label}-${crypto.randomUUID()}@DQGM.dev`
  const displayName = `E2E ${label} ${crypto.randomUUID().slice(0, 8)}`
  const response = await context.request.post('/api/auth/register', {
    data: { email, displayName, password: 'Password123' },
  })
  expect(response.status()).toBe(201)
  const auth = await response.json()
  const account: Account = { id: auth.user.id, email, displayName, token: auth.accessToken }
  const page = await context.newPage()
  const wire = capture(page)
  // Exercise the HTTP LAN fallback even on localhost's secure context.
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }))
  await page.goto('/')
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  return { context, page, account, wire }
}

async function send(page: Page, content: string) {
  // Deliberate workload pacing: F11 permits 10 sends per rolling five seconds.
  // This delay is before STOMP SEND and is not included in measured transport latency.
  await new Promise((resolve) => setTimeout(resolve, 550))
  await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).fill(content)
  await page.getByRole('button', { name: 'Gửi', exact: true }).click()
}

test('F03/F04: real channel membership, DM privacy, persistence and localhost latency', async ({ browser }) => {
  const people = []
  try {
    for (const label of ['Alice', 'Bob', 'Carol']) people.push(await employee(browser, label))
    const [alice, bob, carol] = people
    const channelName = `E2E-${crypto.randomUUID().slice(0, 12)}`
    await alice.page.getByRole('button', { name: 'Tạo kênh', exact: true }).click()
    await alice.page.getByRole('textbox', { name: 'Tên kênh', exact: true }).fill(channelName)
    await alice.page.getByRole('dialog').getByRole('button', { name: 'Tạo kênh', exact: true }).click()
    await expect(alice.page.getByRole('heading', { name: channelName, exact: true })).toBeVisible()
    const channelUrl = alice.page.url()
    const channelId = new URL(channelUrl).pathname.split('/').pop()!

    await bob.page.reload() // discover the channel created while Bob was already online
    await expect(bob.page.getByText('Đã kết nối', { exact: true })).toBeVisible()
    await bob.page.getByRole('button', { name: 'Duyệt kênh', exact: true }).click()
    await bob.page.getByRole('button', { name: `Tham gia ${channelName}`, exact: true }).click()
    await expect(bob.page.getByRole('heading', { name: channelName, exact: true })).toBeVisible()

    const greeting = `Xin chào ${crypto.randomUUID()}`
    await send(alice.page, greeting)
    await expect(bob.page.getByText(greeting, { exact: true })).toBeVisible()
    await expect(alice.page.locator('.message-content').filter({ hasText: greeting })).toHaveCount(1)
    await expect(alice.page.getByText('Đang gửi…', { exact: true })).toHaveCount(0)
    expect(carol.wire.events.some((e) => e.payload.roomId === channelId)).toBe(false)

    const reload = await bob.page.reload()
    expect(reload?.status()).toBe(200)
    await expect(bob.page.getByText(greeting, { exact: true })).toBeVisible()
    await expect(bob.page.getByText('Đã kết nối', { exact: true })).toBeVisible()

    const latencies: number[] = []
    for (let i = 0; i < 20; i++) {
      const text = `latency-${channelId}-${i}`
      await send(alice.page, text)
      await expect.poll(() => bob.wire.received.has(text)).toBe(true)
      latencies.push(bob.wire.received.get(text)! - alice.wire.sent.get(text)!)
    }
    latencies.sort((x, y) => x - y)
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]
    console.log(`Localhost: 20 sequential messages, 3 browser contexts, 2 channel members, STOMP SEND→receiver frame; p50=${latencies[9].toFixed(1)}ms, p95=${p95.toFixed(1)}ms, max=${latencies[19].toFixed(1)}ms`)
    expect(p95).toBeLessThan(200)

    await bob.page.getByRole('button', { name: 'Rời kênh', exact: true }).click()
    await expect(bob.page.getByRole('button', { name: 'Tham gia kênh', exact: true })).toBeVisible()
    const afterLeave = `after-leave-${crypto.randomUUID()}`
    await send(alice.page, afterLeave)
    await expect.poll(() => alice.wire.received.has(afterLeave)).toBe(true)
    expect(bob.wire.received.has(afterLeave)).toBe(false)

    // Search and create a DM through the actual frontend.
    await alice.page.getByRole('button', { name: 'Tin nhắn mới', exact: true }).click()
    await alice.page.getByRole('searchbox', { name: 'Tìm nhân viên' }).fill(bob.account.email)
    await alice.page.getByRole('button', { name: new RegExp(bob.account.displayName) }).click()
    await expect(alice.page.getByRole('heading', { name: bob.account.displayName, exact: true })).toBeVisible()
    const dmUrl = alice.page.url()
    const dmId = new URL(dmUrl).pathname.split('/').pop()!
    const secret = `private-${crypto.randomUUID()}`
    await send(alice.page, secret)
    // Bob discovers a new DM from its first event, without reloading.
    await bob.page.getByRole('link', { name: alice.account.displayName, exact: true }).click()
    await expect(bob.page.getByText(secret, { exact: true })).toBeVisible()
    expect(carol.wire.events.some((e) => e.payload.roomId === dmId)).toBe(false)

    const forbidden = await carol.context.request.get(`/api/rooms/${dmId}/messages`, {
      headers: { Authorization: `Bearer ${carol.account.token}` },
    })
    expect(forbidden.status()).toBe(403)
    const attempts = await Promise.all([
      alice.context.request.post('/api/dms', { data: { userId: bob.account.id }, headers: { Authorization: `Bearer ${alice.account.token}` } }),
      bob.context.request.post('/api/dms', { data: { userId: alice.account.id }, headers: { Authorization: `Bearer ${bob.account.token}` } }),
    ])
    for (const result of attempts) {
      expect(result.status()).toBe(200)
      expect((await result.json()).id).toBe(dmId)
    }
    await bob.page.reload()
    await expect(bob.page.getByText(secret, { exact: true })).toBeVisible()
    // Recover a missed event when the browser connection goes offline and returns.
    await bob.context.setOffline(true)
    const missed = `reconnect-${crypto.randomUUID()}`
    await send(alice.page, missed)
    await expect.poll(() => alice.wire.received.has(missed)).toBe(true)
    await bob.context.setOffline(false)
    await expect(bob.page.getByText(missed, { exact: true })).toBeVisible()
    await expect(bob.page.getByText('Đã kết nối', { exact: true })).toBeVisible()
    expect(bob.page.url()).toBe(dmUrl)
  } finally {
    await Promise.all(people.map((person) => person.context.close()))
  }
})
