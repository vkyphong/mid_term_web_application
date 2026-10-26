import { test, expect, type Browser, type Page } from '@playwright/test'

/** F05: cuộn lên tải thêm lịch sử theo cursor, gộp với tin realtime, không trùng/thiếu. */
const TOTAL = 65

async function employee(browser: Browser, label: string) {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const response = await context.request.post('/api/auth/register', {
    data: {
      email: `e2e-history-${label}-${crypto.randomUUID()}@DQGM.dev`,
      displayName: `E2E history ${label}`,
      password: 'Password123',
    },
  })
  expect(response.status()).toBe(201)
  const token = (await response.json()).accessToken as string
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  return { context, page, token }
}

async function send(page: Page, content: string) {
  await page.getByRole('textbox', { name: 'Nội dung tin nhắn' }).fill(content)
  await page.keyboard.press('Enter')
}

/** Số thứ tự các tin "#n" đang hiển thị, theo thứ tự trên màn hình. */
const shownNumbers = (page: Page) =>
  page.locator('.message-content').evaluateAll((els) =>
    els.map((el) => el.textContent ?? '').filter((t) => /^#\d+$/.test(t)).map((t) => Number(t.slice(1))),
  )

test('F05: cuộn lên tải hết lịch sử theo trang 30 tin, không trùng/thiếu, giữ vị trí đọc, gộp tin realtime', async ({ browser }) => {
  const alice = await employee(browser, 'alice')
  const bob = await employee(browser, 'bob')
  try {
    const created = await alice.context.request.post('/api/rooms', {
      data: { name: `E2E-history-${crypto.randomUUID().slice(0, 8)}` },
      headers: { Authorization: `Bearer ${alice.token}` },
    })
    expect(created.status()).toBe(201)
    const roomId = (await created.json()).id as string

    await bob.page.goto(`/rooms/${roomId}`)
    await bob.page.getByRole('button', { name: 'Tham gia kênh', exact: true }).click()
    await expect(bob.page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeEnabled()

    await alice.page.goto(`/rooms/${roomId}`)
    await expect(alice.page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeEnabled()
    for (let i = 1; i <= TOTAL; i++) await send(alice.page, `#${i}`)
    await expect(alice.page.getByText('Đang gửi…', { exact: true })).toHaveCount(0, { timeout: 20_000 })
    await expect(bob.page.getByText(`#${TOTAL}`, { exact: true })).toBeVisible()

    // Mở lại phòng: chỉ tải trang mới nhất (30 tin).
    const firstPage = bob.page.waitForResponse((r) => r.url().includes(`/api/rooms/${roomId}/messages`) && !r.url().includes('before='))
    await bob.page.reload()
    expect((await (await firstPage).json()).messages).toHaveLength(30)
    await expect(bob.page.getByText(`#${TOTAL}`, { exact: true })).toBeVisible()
    expect(await shownNumbers(bob.page)).toEqual(Array.from({ length: 30 }, (_, k) => TOTAL - 29 + k))

    // Tin realtime đến trước khi cuộn.
    await send(alice.page, 'live-during-history')
    await expect(bob.page.getByText('live-during-history', { exact: true })).toBeVisible()

    // Cuộn lên đầu: tự tải trang cũ hơn; vị trí đọc được giữ (không bị đẩy về mép trên).
    const scroller = bob.page.locator('.message-scroller')
    const older = bob.page.waitForResponse((r) => r.url().includes('before='))
    await scroller.evaluate((el) => { el.scrollTop = 0 })
    expect((await older).status()).toBe(200)
    await expect(bob.page.getByText(`#${TOTAL - 30}`, { exact: true })).toBeVisible()
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(200)

    // Cuộn tiếp cho tới hết lịch sử.
    for (let i = 0; i < 5 && !(await bob.page.getByText('Đã hiển thị toàn bộ lịch sử').isVisible()); i++) {
      await scroller.evaluate((el) => { el.scrollTop = 0 })
      await bob.page.waitForTimeout(400)
    }
    await expect(bob.page.getByText('Đã hiển thị toàn bộ lịch sử')).toBeVisible()
    expect(await shownNumbers(bob.page)).toEqual(Array.from({ length: TOTAL }, (_, k) => k + 1))
    await expect(bob.page.getByText('live-during-history', { exact: true })).toHaveCount(1)
  } finally {
    await alice.context.close()
    await bob.context.close()
  }
})
