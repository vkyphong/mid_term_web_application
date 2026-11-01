import { test, expect } from '@playwright/test'

// Supply an existing enabled admin account; credentials are never stored in source.
test('admin login, live telemetry, search, confirmation dialogs and mobile layout', async ({ page }) => {
  const email = process.env.ADMIN_TEST_EMAIL
  const password = process.env.ADMIN_TEST_PASSWORD
  test.skip(!email || !password, 'Set ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD to run against a real admin account.')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let statsEvents = 0
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (payload.toString().includes('admin:stats')) statsEvents++ }))
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email!)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password!)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('heading', { name: 'Admin Live Dashboard', exact: true })).toBeVisible()
  await expect(page.getByText('Trực tiếp · mỗi giây', { exact: true })).toBeVisible()
  await expect.poll(() => statsEvents).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole('button', { name: `Ban ${email}` })).toBeDisabled()
  await page.getByRole('searchbox', { name: 'Tìm tài khoản' }).fill(email!)
  await expect(page.locator('.admin-table tbody tr')).toHaveCount(1)
  // Open the real confirmation UI and cancel: this smoke test never broadcasts to real users.
  await page.getByRole('textbox', { name: 'Nội dung broadcast' }).fill('Kiểm tra hộp thoại broadcast')
  await page.getByRole('button', { name: 'Gửi broadcast', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Admin Live Dashboard', exact: true })).toBeVisible()
  await expect(page.getByText('Trực tiếp · mỗi giây', { exact: true })).toBeVisible()
  // A zero-traffic SVG line has a zero-height bounding box, even though its stroke is painted.
  await expect(page.getByRole('img', { name: /Biểu đồ tin nhắn mỗi giây/ })).toBeVisible()
  await expect.poll(() => page.locator('.admin-chart polyline').first().getAttribute('points')).toMatch(/^\S+ \S+/)
  await expect(page.getByText('Đang chờ các mẫu thống kê trực tiếp…', { exact: true })).toHaveCount(0)
  if (process.env.ADMIN_SCREENSHOT_PATH) await page.screenshot({ path: process.env.ADMIN_SCREENSHOT_PATH, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Admin Live Dashboard', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Gửi broadcast', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
