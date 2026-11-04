import { test, expect, type Page } from '@playwright/test'

// Mặc định dùng tài khoản admin demo do backend tạo khi khởi động (DEMO_ADMIN_* trong compose.yml).
// Đặt ADMIN_TEST_EMAIL / ADMIN_TEST_PASSWORD để chạy với tài khoản admin khác.
const email = process.env.ADMIN_TEST_EMAIL ?? 'admin@dqgm.dev'
const password = process.env.ADMIN_TEST_PASSWORD ?? 'Admin123456'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test('admin login, live telemetry, search, confirmation dialogs and mobile layout', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let statsEvents = 0
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => { if (payload.toString().includes('admin:stats')) statsEvents++ }))
  await loginAsAdmin(page)
  await expect(page.getByRole('heading', { name: 'Admin Live Dashboard', exact: true })).toBeVisible()
  await expect(page.getByText('Trực tiếp · mỗi giây', { exact: true })).toBeVisible()
  await expect.poll(() => statsEvents).toBeGreaterThanOrEqual(2)
  // Tìm theo email trước: danh sách sắp theo tên, trang đầu (20 người) chưa chắc có tài khoản admin.
  await page.getByRole('searchbox', { name: 'Tìm tài khoản' }).fill(email)
  await expect(page.locator('#accounts .admin-table tbody tr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: `Ban ${email}` })).toBeDisabled()
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

test('admin quản lý nhóm: tạo, đổi tên, thêm / xoá thành viên, lưu trữ rồi khôi phục', async ({ page, browser }) => {
  // Nhân viên thật để thêm vào nhóm.
  const staff = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const staffEmail = `e2e-admgrp-${crypto.randomUUID()}@dqgm.dev`
  const reg = await staff.request.post('/api/auth/register', { data: { email: staffEmail, displayName: 'Lê Minh Châu', password: 'Password123' } })
  expect(reg.status()).toBe(201)
  const staffToken = (await reg.json()).accessToken as string
  const tag = crypto.randomUUID().slice(0, 6)
  try {
    await loginAsAdmin(page)
    const section = page.getByRole('region', { name: /Quản lý nhóm/ })
    await section.getByRole('button', { name: '+ Tạo nhóm' }).click()
    await page.getByLabel('Tên nhóm').fill(`Phòng QA ${tag}`)
    await page.getByLabel('Mô tả (không bắt buộc)').fill('Nhóm kiểm thử phần mềm')
    await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
    await expect(page.getByText(`Đã tạo nhóm Phòng QA ${tag}.`)).toBeVisible()

    await section.getByRole('searchbox', { name: 'Tìm nhóm' }).fill(tag)
    await expect(section.locator('tbody tr')).toHaveCount(1)
    await section.getByRole('button', { name: `Sửa nhóm Phòng QA ${tag}` }).click()
    await page.getByLabel('Tên nhóm').fill(`Phòng QA mới ${tag}`)
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(section.getByText(`Phòng QA mới ${tag}`)).toBeVisible()

    // Thêm nhân viên → họ thấy nhóm trong danh sách phòng.
    await section.getByRole('button', { name: `Thành viên nhóm Phòng QA mới ${tag}` }).click()
    await page.getByPlaceholder(/Tìm tên hoặc email để thêm/).fill(staffEmail)
    await page.getByRole('list', { name: 'Kết quả tìm kiếm' }).getByRole('button', { name: `Thêm ${staffEmail}` }).click()
    const members = page.getByRole('list', { name: 'Thành viên nhóm' })
    await expect(members.getByText(staffEmail)).toBeVisible()
    const rooms = async () => ((await (await staff.request.get('/api/rooms', { headers: { Authorization: `Bearer ${staffToken}` } })).json()).rooms as { name: string; joined: boolean }[])
    expect((await rooms()).some((r) => r.name === `Phòng QA mới ${tag}` && r.joined)).toBe(true)
    await members.getByRole('button', { name: `Xoá ${staffEmail} khỏi nhóm` }).click()
    await members.getByRole('button', { name: 'Xác nhận xoá' }).click()
    await expect(members.getByText(staffEmail)).toHaveCount(0)
    await page.getByRole('button', { name: 'Đóng', exact: true }).click()

    // Lưu trữ rồi khôi phục.
    await section.getByRole('button', { name: `Lưu trữ nhóm Phòng QA mới ${tag}` }).click()
    await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click()
    await expect(section.locator('tbody tr').getByText('Đã lưu trữ')).toBeVisible()
    await section.getByRole('button', { name: 'Đã lưu trữ', exact: true }).click()
    await expect(section.getByText(`Phòng QA mới ${tag}`)).toBeVisible()
    await section.getByRole('button', { name: `Khôi phục nhóm Phòng QA mới ${tag}` }).click()
    await page.getByRole('button', { name: 'Xác nhận khôi phục' }).click()
    await expect(page.getByText(`Đã khôi phục nhóm Phòng QA mới ${tag}.`)).toBeVisible()
  } finally {
    await staff.close()
  }
})
