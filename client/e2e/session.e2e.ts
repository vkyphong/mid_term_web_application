import { test, expect, type Browser, type Page } from '@playwright/test'

/**
 * F02: token hết hạn → socket bị ngắt → client chỉ kết nối lại bằng token hợp lệ.
 * Cần BE chạy với access token ngắn: ACCESS_TTL_SECONDS=20 docker compose up -d app
 * rồi E2E_ACCESS_TTL_SECONDS=20 npm run test:e2e -- session.
 */
const TTL = Number(process.env.E2E_ACCESS_TTL_SECONDS)
test.skip(!TTL || TTL > 30, 'Requires the backend started with a short ACCESS_TTL_SECONDS (≤ 30) and E2E_ACCESS_TTL_SECONDS set to it')

interface Connect { at: number; token: string }
interface Wire {
  connects: Connect[]
  connected: number[]
  errors: string[]
  closedAt: number[]
}

/** Ghi lại CONNECT (kèm token), CONNECTED, ERROR và thời điểm socket đóng. */
function watchStomp(page: Page): Wire {
  const wire: Wire = { connects: [], connected: [], errors: [], closedAt: [] }
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const raw = payload.toString()
      if (!raw.startsWith('CONNECT')) return
      const token = /^Authorization:Bearer (.*)$/m.exec(raw)?.[1] ?? ''
      wire.connects.push({ at: Date.now(), token })
    })
    socket.on('framereceived', ({ payload }) => {
      const raw = payload.toString()
      if (raw.startsWith('CONNECTED')) wire.connected.push(Date.now())
      if (raw.startsWith('ERROR')) wire.errors.push(raw.replace(/\0/g, ''))
    })
    socket.on('close', () => wire.closedAt.push(Date.now()))
  })
  return wire
}

/** Đăng ký qua API (đặt refresh cookie), mở app và lấy token mà FE nhận khi khôi phục phiên. */
async function signedIn(browser: Browser, label: string, beforeLoad?: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const email = `e2e-session-${label}-${crypto.randomUUID()}@DQGM.dev`
  const response = await context.request.post('/api/auth/register', {
    data: { email, displayName: `E2E session ${label}`, password: 'Password123' },
  })
  expect(response.status()).toBe(201)
  const page = await context.newPage()
  const wire = watchStomp(page)
  const refreshes: { at: number; token: string; expiresIn: number }[] = []
  page.on('response', async (res) => {
    if (!res.url().endsWith('/api/auth/refresh') || res.status() !== 200) return
    const body = await res.json()
    refreshes.push({ at: Date.now(), token: body.accessToken, expiresIn: body.expiresIn })
  })
  await beforeLoad?.(page)
  await page.goto('/')
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  await expect.poll(() => refreshes.length).toBeGreaterThan(0)
  expect(refreshes[0].expiresIn).toBe(TTL)
  const first = { token: refreshes[0].token, expiresAt: refreshes[0].at + TTL * 1000 }
  return { context, page, wire, refreshes, first }
}

test('F02 A: refresh chủ động trước khi hết hạn và kết nối lại bằng token mới', async ({ browser }) => {
  const { context, page, wire, refreshes, first } = await signedIn(browser, 'proactive')
  try {
    // Chờ qua mốc hết hạn của token đầu tiên.
    await page.waitForTimeout(first.expiresAt - Date.now() + 2_000)

    expect(refreshes.length).toBeGreaterThanOrEqual(2)
    const second = refreshes[1]
    expect(second.token).not.toBe(first.token)
    expect(second.at).toBeLessThan(first.expiresAt)

    // Socket mới CONNECT bằng token mới và được CONNECTED; không có ERROR nào.
    const reconnect = wire.connects.find((c) => c.token === second.token)
    expect(reconnect).toBeDefined()
    expect(wire.connected.some((t) => t >= reconnect!.at)).toBe(true)
    expect(wire.errors).toEqual([])
    // Sau mốc hết hạn không còn CONNECT nào dùng token cũ.
    expect(wire.connects.filter((c) => c.at > first.expiresAt && c.token === first.token)).toEqual([])
    await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
    const rel = (t: number) => `${((t - (first.expiresAt - TTL * 1000)) / 1000).toFixed(1)}s`
    console.log(`F02 A (TTL ${TTL}s): refresh at ${rel(second.at)}, reconnect CONNECT at ${rel(reconnect!.at)} with new token; ${wire.connects.length} CONNECT, ${wire.errors.length} ERROR`)
  } finally {
    await context.close()
  }
})

test('F02 B: token hết hạn khi chưa refresh được → server ngắt, client chỉ kết nối lại bằng token hợp lệ', async ({ browser }) => {
  let blockUntil = Number.POSITIVE_INFINITY
  const { context, page, wire, refreshes, first } = await signedIn(browser, 'expired', async (page) => {
    // Lần refresh lúc tải trang được đi qua; các lần sau bị lỗi mạng cho tới khi token đầu đã hết hạn.
    let calls = 0
    await page.route('**/api/auth/refresh', (route) =>
      calls++ === 0 || Date.now() >= blockUntil ? route.continue() : route.abort('failed'),
    )
  })
  // Chặn tới 3 s sau hết hạn: đủ dài để thư viện STOMP kịp thử reconnect (độ trễ 3 s) trong lúc chưa có token mới.
  blockUntil = first.expiresAt + 3_000
  try {
    // Server phải đóng socket của token đầu khi nó hết hạn.
    await expect
      .poll(() => wire.closedAt.find((t) => t >= first.expiresAt - 1_000), { timeout: (TTL + 5) * 1000 })
      .toBeDefined()

    // Sau đó FE refresh được và kết nối lại.
    await expect.poll(() => refreshes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    const fresh = refreshes[refreshes.length - 1].token
    await expect.poll(() => wire.connects.some((c) => c.token === fresh), { timeout: 10_000 }).toBe(true)
    await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()

    // Mọi CONNECT sau khi hết hạn đều dùng token mới, không retry bằng token đã hết hạn.
    const afterExpiry = wire.connects.filter((c) => c.at > first.expiresAt)
    expect(afterExpiry.length).toBeGreaterThan(0)
    expect(afterExpiry.every((c) => c.token !== first.token)).toBe(true)
    expect(wire.errors).toEqual([])
    const rel = (t: number) => `${((t - (first.expiresAt - TTL * 1000)) / 1000).toFixed(1)}s`
    const closed = wire.closedAt.find((t) => t >= first.expiresAt - 1_000)!
    console.log(`F02 B (TTL ${TTL}s): server closed socket at ${rel(closed)}, CONNECTs after expiry: ${afterExpiry.length} (all new token), first at ${rel(afterExpiry[0].at)}; ${wire.errors.length} ERROR`)
  } finally {
    await context.close()
  }
})

test('F02 C: refresh bị từ chối → về trang đăng nhập, không kết nối lại vòng lặp', async ({ browser }) => {
  let reject = false
  const { context, page, wire, first } = await signedIn(browser, 'revoked', async (page) => {
    await page.route('**/api/auth/refresh', (route) =>
      reject
        ? route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'unauthorized', reason: 'refresh_invalid' } }),
          })
        : route.continue(),
    )
  })
  reject = true
  try {
    await expect(page.getByText('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')).toBeVisible({
      timeout: (TTL + 10) * 1000,
    })
    await expect(page).toHaveURL(/\/login$/)
    // Đợi qua mốc hết hạn: chỉ có đúng một CONNECT (lúc tải trang), không thử lại bằng token cũ.
    await page.waitForTimeout(Math.max(0, first.expiresAt - Date.now()) + 5_000)
    expect(wire.connects).toHaveLength(1)
    expect(wire.connects[0].token).toBe(first.token)
    console.log(`F02 C (TTL ${TTL}s): refresh rejected → sign-in page with expiry notice; total CONNECT attempts: ${wire.connects.length}`)
  } finally {
    await context.close()
  }
})
