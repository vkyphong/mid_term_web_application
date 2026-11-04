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
  // Mã dự án ngẫu nhiên giúp tìm đúng nhóm vừa tạo; tên nhóm trông như trong công ty.
  const tag = `DA-${1000 + Math.floor(Math.random() * 9000)}`
  try {
    await loginAsAdmin(page)
    const section = page.getByRole('region', { name: /Quản lý nhóm/ })
    await section.getByRole('button', { name: '+ Tạo nhóm' }).click()
    await page.getByLabel('Tên nhóm').fill(`Phòng Kiểm thử ${tag}`)
    await page.getByLabel('Mô tả (không bắt buộc)').fill('Nhóm kiểm thử phần mềm')
    await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
    await expect(page.getByText(`Đã tạo nhóm Phòng Kiểm thử ${tag}.`)).toBeVisible()

    await section.getByRole('searchbox', { name: 'Tìm nhóm' }).fill(tag)
    await expect(section.locator('tbody tr')).toHaveCount(1)
    await section.getByRole('button', { name: `Sửa nhóm Phòng Kiểm thử ${tag}` }).click()
    await page.getByLabel('Tên nhóm').fill(`Phòng QA ${tag}`)
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(section.getByText(`Phòng QA ${tag}`)).toBeVisible()

    // Thêm nhân viên → họ thấy nhóm trong danh sách phòng.
    await section.getByRole('button', { name: `Thành viên nhóm Phòng QA ${tag}` }).click()
    await page.getByPlaceholder(/Tìm tên hoặc email để thêm/).fill(staffEmail)
    await page.getByRole('list', { name: 'Kết quả tìm kiếm' }).getByRole('button', { name: `Thêm ${staffEmail}` }).click()
    const members = page.getByRole('list', { name: 'Thành viên nhóm' })
    await expect(members.getByText(staffEmail)).toBeVisible()
    // Vai trò: phó nhóm, rồi chuyển trưởng nhóm (admin tạo nhóm nên đang là trưởng nhóm).
    await page.getByRole('combobox', { name: 'Vai trò của Lê Minh Châu' }).selectOption('deputy')
    await expect(page.getByText(/Lê Minh Châu giờ là phó nhóm/)).toBeVisible()
    await page.getByRole('combobox', { name: 'Vai trò của Lê Minh Châu' }).selectOption('owner')
    await page.getByRole('alertdialog', { name: 'Xác nhận chuyển trưởng nhóm' }).getByRole('button', { name: 'Xác nhận chuyển' }).click()
    await expect(page.getByRole('combobox', { name: 'Vai trò của Lê Minh Châu' })).toHaveValue('owner')
    await expect(page.getByRole('combobox', { name: 'Vai trò của Lê Minh Châu' })).toBeDisabled()
    // Bật phê duyệt: nhân viên (trưởng nhóm mới) thấy ngay trong dữ liệu phòng.
    await page.getByRole('switch', { name: /Phê duyệt thành viên mới/ }).check()
    await expect(page.getByText(/Đã bật phê duyệt thành viên mới/)).toBeVisible()
    const roomsFull = async () => ((await (await staff.request.get('/api/rooms', { headers: { Authorization: `Bearer ${staffToken}` } })).json()).rooms as { name: string; requireApproval?: boolean }[])
    expect((await roomsFull()).find((r) => r.name === `Phòng QA ${tag}`)?.requireApproval).toBe(true)
    const rooms = async () => ((await (await staff.request.get('/api/rooms', { headers: { Authorization: `Bearer ${staffToken}` } })).json()).rooms as { name: string; joined: boolean }[])
    expect((await rooms()).some((r) => r.name === `Phòng QA ${tag}` && r.joined)).toBe(true)
    await members.getByRole('button', { name: `Xoá ${staffEmail} khỏi nhóm` }).click()
    await members.getByRole('button', { name: 'Xác nhận xoá' }).click()
    await expect(members.getByText(staffEmail)).toHaveCount(0)
    await page.getByRole('button', { name: 'Đóng', exact: true }).click()

    // Lưu trữ rồi khôi phục.
    await section.getByRole('button', { name: `Lưu trữ nhóm Phòng QA ${tag}` }).click()
    await page.getByRole('button', { name: 'Xác nhận lưu trữ' }).click()
    await expect(section.locator('tbody tr').getByText('Đã lưu trữ')).toBeVisible()
    await section.getByRole('button', { name: 'Đã lưu trữ', exact: true }).click()
    await expect(section.getByText(`Phòng QA ${tag}`)).toBeVisible()
    await section.getByRole('button', { name: `Khôi phục nhóm Phòng QA ${tag}` }).click()
    await page.getByRole('button', { name: 'Xác nhận khôi phục' }).click()
    await expect(page.getByText(`Đã khôi phục nhóm Phòng QA ${tag}.`)).toBeVisible()
  } finally {
    await staff.close()
  }
})

test('admin khoá rồi mở khoá tài khoản, cấp rồi thu quyền admin', async ({ page, browser }) => {
  const staff = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const staffEmail = `e2e-admusr-${crypto.randomUUID()}@dqgm.dev`
  expect((await staff.request.post('/api/auth/register', { data: { email: staffEmail, displayName: 'Trần Gia Bảo', password: 'Password123' } })).status()).toBe(201)
  const login = () => staff.request.post('/api/auth/login', { data: { email: staffEmail, password: 'Password123' } })
  try {
    await loginAsAdmin(page)
    const accounts = page.locator('#accounts')
    await page.getByRole('searchbox', { name: 'Tìm tài khoản' }).fill(staffEmail)
    await expect(accounts.locator('tbody tr')).toHaveCount(1)

    await page.getByRole('button', { name: `Ban ${staffEmail}` }).click()
    await page.getByRole('button', { name: 'Xác nhận Ban' }).click()
    await expect(page.getByRole('button', { name: `Mở khóa ${staffEmail}` })).toBeVisible()
    expect((await login()).status()).toBe(403)
    await page.getByRole('button', { name: `Mở khóa ${staffEmail}` }).click()
    await page.getByRole('button', { name: 'Xác nhận mở khóa' }).click()
    await expect(page.getByRole('button', { name: `Ban ${staffEmail}` })).toBeEnabled()
    expect((await login()).status()).toBe(200)

    await page.getByRole('button', { name: `Cấp quyền admin ${staffEmail}` }).click()
    await page.getByRole('button', { name: 'Xác nhận cấp quyền' }).click()
    await expect(page.getByRole('button', { name: `Thu quyền admin ${staffEmail}` })).toBeVisible()
    expect((await (await login()).json()).user.role).toBe('admin')
    await page.getByRole('button', { name: `Thu quyền admin ${staffEmail}` }).click()
    await page.getByRole('button', { name: 'Xác nhận thu hồi' }).click()
    await expect(page.getByRole('button', { name: `Cấp quyền admin ${staffEmail}` })).toBeVisible()
    expect((await (await login()).json()).user.role).toBe('user')
  } finally {
    await staff.close()
  }
})
