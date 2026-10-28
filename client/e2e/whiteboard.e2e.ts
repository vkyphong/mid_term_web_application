import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface Account { context: BrowserContext; token: string; id: string }
interface Segment { operationId: string; authorId: string; generation: number; revision: number; color: string; points: { x: number; y: number }[] }
interface Snapshot { roomId: string; generation: number; revision: number; segments: Segment[] }
async function account(browser: Browser, label: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080', hasTouch: true, viewport: { width: 1280, height: 900 } })
  const response = await context.request.post('/api/auth/register', { data: { email: `wb-${label}-${randomUUID()}@dqgm.dev`, displayName: `Whiteboard ${label}`, password: 'BoardBrowser123' } })
  expect(response.status()).toBe(201)
  const auth = await response.json()
  return { context, token: auth.accessToken, id: auth.user.id }
}
async function channel(owner: Account) {
  const response = await owner.context.request.post('/api/rooms', { headers: { Authorization: `Bearer ${owner.token}` }, data: { name: `WB-${randomUUID().slice(0, 8)}` } })
  expect(response.status()).toBe(201)
  return (await response.json()).id as string
}
async function snapshot(user: Account, room: string): Promise<Snapshot> {
  const response = await user.context.request.get(`/api/rooms/${room}/whiteboard`, { headers: { Authorization: `Bearer ${user.token}` } })
  expect(response.status()).toBe(200)
  return response.json()
}
function capture(page: Page, room: string) {
  const events: { type: string; payload: { roomId: string; revision: number } }[] = []
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    for (const raw of payload.toString().split('\0')) {
      const start = raw.indexOf('\n\n')
      if (!raw.trimStart().startsWith('MESSAGE') || start < 0) continue
      try { const event = JSON.parse(raw.slice(start + 2)); if (event.type.startsWith('whiteboard:') && event.payload.roomId === room) events.push(event) } catch { /* Heartbeats are not JSON. */ }
    }
  }))
  return events
}
async function openBoard(page: Page) {
  await page.getByRole('tab', { name: 'Bảng trắng', exact: true }).click()
  await expect(page.locator('canvas')).toHaveAttribute('aria-disabled', 'false')
}
async function draw(page: Page, offset: number) {
  const box = await page.locator('canvas').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * .1, box!.y + box!.height * (.2 + offset))
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(box!.x + box!.width * (.1 + i * .035), box!.y + box!.height * (.2 + offset + Math.sin(i / 3) * .07), { steps: 2 })
  await page.mouse.up()
  await expect(page.locator('.whiteboard-status')).toContainText('Đã đồng bộ')
}
async function pixels(page: Page) {
  return page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 2166136261, ink = 0
    const tiles = new Array<number>(50 * 30 * 4).fill(0)
    for (let i = 0; i < data.length; i += 4) {
      const pixel = i / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width)
      const tile = (Math.floor(y / 20) * 50 + Math.floor(x / 20)) * 4
      for (let channel = 0; channel < 4; channel++) {
        hash = Math.imul(hash ^ data[i + channel], 16777619)
        tiles[tile + channel] += channel === 3 ? data[i + channel] : data[i + channel] * data[i + 3] / 255
      }
      if (data[i + 3] > 0) ink++
    }
    return { hash: hash >>> 0, ink, tiles }
  })
}
async function samePixels(a: Page, b: Page) {
  let diagnostic: unknown
  try { await expect.poll(async () => {
    const [left, right, aVersion, bVersion] = await Promise.all([pixels(a), pixels(b), a.locator('.whiteboard-version').innerText(), b.locator('.whiteboard-version').innerText()])
    // GPU/CPU Canvas anti-aliasing can differ by a handful of edge pixels after readback.
    // Compare spatial RGBA sums and server version, rather than requiring bit-identical rasterization.
    const difference = left.tiles.reduce((sum, value, i) => sum + Math.abs(value - right.tiles[i]), 0)
    diagnostic = { aVersion, bVersion, leftInk: left.ink, rightInk: right.ink, difference, tolerance: Math.max(2048, Math.max(left.ink, right.ink) * 255 * .002), aStatus: await a.locator('.whiteboard-status').innerText(), bStatus: await b.locator('.whiteboard-status').innerText() }
    return aVersion === bVersion && difference <= Math.max(2048, Math.max(left.ink, right.ink) * 255 * .002)
  }).toBe(true) } catch (error) { console.log('Whiteboard comparison:', JSON.stringify(diagnostic)); throw error }
}
async function forbiddenSend(page: Page, token: string, room: string) {
  return page.evaluate(async ({ token, room }) => new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`, 'v12.stomp')
    const correlation = crypto.randomUUID()
    const timer = setTimeout(() => { socket.close(); reject(new Error('Outsider ack timeout')) }, 5000)
    socket.onopen = () => socket.send(`CONNECT\naccept-version:1.2\nhost:localhost\nAuthorization:Bearer ${token}\n\n\0`)
    socket.onmessage = ({ data }) => {
      for (const frame of String(data).split('\0')) {
        if (frame.startsWith('CONNECTED')) {
          socket.send('SUBSCRIBE\nid:ack\ndestination:/user/queue/acks\n\n\0')
          socket.send(`SEND\ndestination:/app/whiteboard.segment\ncontent-type:application/json\n\n${JSON.stringify({ type: 'whiteboard:segment', payload: { roomId: room, operationId: crypto.randomUUID(), generation: 0, color: '#1f2937', width: 4, points: [{ x: .1, y: .2 }] }, ts: new Date().toISOString(), correlationId: correlation })}\0`)
        } else if (frame.startsWith('MESSAGE')) {
          const value = JSON.parse(frame.slice(frame.indexOf('\n\n') + 2))
          if (value.type === 'ack' && value.payload.correlationId === correlation) { clearTimeout(timer); socket.close(); resolve(value.payload.error?.code ?? 'unexpected_success') }
        }
      }
    }
    socket.onerror = () => { clearTimeout(timer); reject(new Error('Outsider socket failed')) }
  }), { token, room })
}

test('F19: concurrent room drawing, isolation, chat, reload/reconnect, touch, clear and membership', async ({ browser }) => {
  const [alice, bob, carol] = await Promise.all([account(browser, 'Alice'), account(browser, 'Bob'), account(browser, 'Carol')])
  const errors: string[] = []
  try {
    const room = await channel(alice), otherRoom = await channel(carol)
    const a = await alice.context.newPage(), b = await bob.context.newPage(), c = await carol.context.newPage()
    for (const page of [a, b, c]) { page.setDefaultTimeout(15_000); page.on('pageerror', (e) => errors.push(e.message)) }
    const aEvents = capture(a, room), bEvents = capture(b, room), cEvents = capture(c, room)
    await Promise.all([a.goto(`/rooms/${room}`), b.goto(`/rooms/${room}`), c.goto(`/rooms/${otherRoom}`)])
    await Promise.all([a, b, c].map((page) => expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()))
    await b.getByRole('button', { name: 'Tham gia kênh', exact: true }).click()
    await expect(b.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeEnabled()
    await Promise.all([openBoard(a), openBoard(b), openBoard(c)])
    await a.getByRole('button', { name: 'Bút màu đỏ', exact: true }).click()
    await b.getByRole('button', { name: 'Bút màu xanh dương', exact: true }).click()
    await Promise.all([draw(a, 0), draw(b, .35)])
    const persisted = await snapshot(alice, room)
    expect(persisted.segments.length).toBeGreaterThanOrEqual(2)
    expect(new Set(persisted.segments.map((s) => s.authorId))).toEqual(new Set([alice.id, bob.id]))
    expect(new Set(persisted.segments.map((s) => s.operationId)).size).toBe(persisted.segments.length)
    expect(persisted.segments.map((s) => s.revision)).toEqual(Array.from({ length: persisted.segments.length }, (_, i) => i + 1))
    await samePixels(a, b)
    expect((await pixels(a)).ink).toBeGreaterThan(100)
    expect((await pixels(c)).ink).toBe(0)
    expect(cEvents).toEqual([])
    const denied = await carol.context.request.get(`/api/rooms/${room}/whiteboard`, { headers: { Authorization: `Bearer ${carol.token}` } })
    expect(denied.status()).toBe(403)
    expect(await forbiddenSend(c, carol.token, room)).toBe('forbidden')

    // Chat uses its normal quota while another member is drawing.
    await b.getByRole('tab', { name: 'Trò chuyện', exact: true }).click()
    await Promise.all([draw(a, .12), (async () => {
      await b.getByRole('textbox', { name: 'Nội dung tin nhắn' }).fill('Chat vẫn hoạt động khi vẽ bảng trắng')
      await b.getByRole('textbox', { name: 'Nội dung tin nhắn' }).press('Enter')
      await expect(b.locator('.message').filter({ hasText: 'Chat vẫn hoạt động khi vẽ bảng trắng' })).toBeVisible()
    })()])
    await openBoard(b)
    await samePixels(a, b)
    const beforeReload = await snapshot(alice, room)
    await a.reload(); await openBoard(a)
    expect(await snapshot(alice, room)).toEqual(beforeReload)
    await samePixels(a, b)

    await alice.context.setOffline(true)
    await expect(a.locator('canvas')).toHaveAttribute('aria-disabled', 'true')
    await draw(b, .55)
    await alice.context.setOffline(false)
    await expect(a.locator('canvas')).toHaveAttribute('aria-disabled', 'false', { timeout: 20_000 })
    await samePixels(a, b)

    const beforeLeave = bEvents.length
    await b.getByRole('button', { name: 'Rời kênh', exact: true }).click()
    await expect(b.getByRole('button', { name: 'Tham gia kênh', exact: true })).toBeVisible()
    await draw(a, .22)
    expect(bEvents.length).toBe(beforeLeave)
    expect((await bob.context.request.get(`/api/rooms/${room}/whiteboard`, { headers: { Authorization: `Bearer ${bob.token}` } })).status()).toBe(403)
    await b.getByRole('button', { name: 'Tham gia kênh', exact: true }).click(); await openBoard(b)
    await samePixels(a, b)

    await b.setViewportSize({ width: 390, height: 844 })
    expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await b.locator('canvas').boundingBox()
    await b.touchscreen.tap(box!.x + box!.width * .9, box!.y + box!.height * .1)
    await expect(b.locator('.whiteboard-status')).toContainText('Đã đồng bộ')
    await samePixels(a, b)
    const evidence = process.env.WHITEBOARD_EVIDENCE_DIR
    const populated = await snapshot(alice, room)
    if (evidence) {
      await mkdir(evidence, { recursive: true })
      await a.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true })
      await b.screenshot({ path: join(evidence, 'mobile.png'), fullPage: true })
    }

    await a.getByRole('button', { name: 'Xóa bảng', exact: true }).click()
    await a.getByRole('button', { name: 'Hủy', exact: true }).click()
    expect((await snapshot(alice, room)).generation).toBe(0)
    await a.getByRole('button', { name: 'Xóa bảng', exact: true }).click()
    await a.getByRole('button', { name: 'Xác nhận xóa bảng', exact: true }).click()
    await expect.poll(async () => (await snapshot(alice, room)).segments.length).toBe(0)
    await expect.poll(async () => (await pixels(b)).ink).toBe(0)
    expect((await snapshot(alice, room)).generation).toBe(1)
    await expect(a.locator('canvas')).toHaveAttribute('aria-disabled', 'false')
    await draw(a, .1)
    await samePixels(a, b)
    const afterClear = await snapshot(alice, room)
    expect(afterClear.segments.every((s) => s.generation === 1)).toBe(true)
    expect(cEvents).toEqual([])
    expect(errors).toEqual([])
    if (evidence) {
      const image = await pixels(a)
      await writeFile(join(evidence, 'verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), environment: 'Chrome / real Docker app + MySQL', checks: ['simultaneous authors', 'same revision and spatial RGBA comparison with Canvas anti-aliasing tolerance', 'outsider read/send/event denial', 'room isolation', 'chat during drawing', 'reload persistence', 'offline recovery', 'leave/rejoin', 'mobile touch', 'confirmed clear and fresh generation'], populated, afterClear, canvas: { hash: image.hash, ink: image.ink }, authorEventCount: aEvents.length, outsiderEventCount: cEvents.length, pageErrors: errors }, null, 2))
    }
  } finally { await Promise.all([alice.context.close(), bob.context.close(), carol.context.close()]) }
})
