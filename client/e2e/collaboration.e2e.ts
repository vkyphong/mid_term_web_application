import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { crc32, deflateSync } from 'node:zlib'

/** F09 thông báo/@mention, F14 sửa/xoá/cảm xúc, F15 file, F10 hàng đợi offline, F11 giới hạn & XSS — backend thật. */

interface Account { context: BrowserContext; id: string; token: string; displayName: string }

async function account(browser: Browser, label: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const displayName = `E2E ${label} ${crypto.randomUUID().slice(0, 6)}`
  const res = await context.request.post('/api/auth/register', {
    data: { email: `e2e-col-${label}-${crypto.randomUUID()}@DQGM.dev`, displayName, password: 'Password123' },
  })
  expect(res.status()).toBe(201)
  const auth = await res.json()
  return { context, id: auth.user.id, token: auth.accessToken, displayName }
}

async function open(acc: Account, path: string): Promise<Page> {
  const page = await acc.context.newPage()
  await page.goto(path)
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  return page
}

async function channelWith(owner: Account, ...members: Account[]) {
  const res = await owner.context.request.post('/api/rooms', {
    data: { name: `E2E-col-${crypto.randomUUID().slice(0, 8)}` }, headers: { Authorization: `Bearer ${owner.token}` },
  })
  expect(res.status()).toBe(201)
  const roomId = (await res.json()).id as string
  for (const m of members) {
    const page = await open(m, `/rooms/${roomId}`)
    await page.getByRole('button', { name: 'Tham gia kênh', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Nội dung tin nhắn' })).toBeEnabled()
    await page.close()
  }
  return roomId
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Nội dung tin nhắn' })
async function send(page: Page, text: string) {
  await box(page).fill(text)
  await page.keyboard.press('Enter')
}
const bubble = (page: Page, text: string) => page.locator('.message', { hasText: text })

/** PNG hợp lệ (BE kiểm tra giải mã được ảnh). */
function png(width = 4, height = 4): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x7f)
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

test('F09: @mention chọn từ thành viên, toast + badge không cần reload, mở đúng hội thoại, đồng bộ đã đọc giữa các tab, không lộ cho người khác', async ({ browser }) => {
  const [alice, bob, carol] = await Promise.all([account(browser, 'alice'), account(browser, 'bob'), account(browser, 'carol')])
  try {
    const roomId = await channelWith(alice, bob, carol)
    const a = await open(alice, `/rooms/${roomId}`)
    const bobHome = await open(bob, '/')
    const bobTab2 = await open(bob, '/')
    const carolHome = await open(carol, '/')
    const bell = (p: Page) => p.getByRole('button', { name: /^Thông báo/ })

    // Gõ "@" + vài chữ → chọn Bob từ danh sách thành viên.
    await box(a).pressSequentially(`Nhờ @${bob.displayName.split(' ')[1]}`)
    await a.getByRole('option', { name: bob.displayName }).click()
    await box(a).pressSequentially('xem giúp')
    await a.keyboard.press('Enter')
    await expect(bubble(a, 'xem giúp').locator('.mention')).toHaveText(`@${bob.displayName}`)

    // Bob: toast + badge xuất hiện ngay, cả hai tab.
    await expect(bobHome.getByRole('status').filter({ hasText: 'Bạn được nhắc đến' })).toBeVisible()
    await expect(bell(bobHome)).toHaveAccessibleName('Thông báo, 1 chưa đọc')
    await expect(bell(bobTab2)).toHaveAccessibleName('Thông báo, 1 chưa đọc')
    // Carol cùng kênh nhưng không được nhắc → không có thông báo.
    await carolHome.waitForTimeout(500)
    await expect(bell(carolHome)).toHaveAccessibleName('Thông báo')

    // Bấm toast → mở đúng kênh, đánh dấu đã đọc, tab còn lại cũng hết badge.
    await bobHome.getByRole('status').filter({ hasText: 'Bạn được nhắc đến' }).getByRole('button').first().click()
    await expect(bobHome).toHaveURL(new RegExp(`/rooms/${roomId}$`))
    await expect(bubble(bobHome, 'xem giúp').locator('.mention--me')).toBeVisible()
    await expect(bell(bobHome)).toHaveAccessibleName('Thông báo')
    await expect(bell(bobTab2)).toHaveAccessibleName('Thông báo')

    // DM → thông báo "Tin nhắn riêng mới" trong danh sách chuông.
    const dm = await (await alice.context.request.post('/api/dms', { data: { userId: bob.id }, headers: { Authorization: `Bearer ${alice.token}` } })).json()
    await a.goto(`/rooms/${dm.id}`)
    await send(a, 'Tin riêng cho Bob')
    await expect(bell(bobTab2)).toHaveAccessibleName('Thông báo, 1 chưa đọc')
    await bell(bobTab2).click()
    await bobTab2.getByRole('region', { name: 'Danh sách thông báo' }).getByRole('button', { name: /Tin nhắn riêng mới/ }).click()
    await expect(bobTab2).toHaveURL(new RegExp(`/rooms/${dm.id}$`))
    await expect(bobTab2.locator('.message-list').getByText('Tin riêng cho Bob')).toBeVisible()
    await expect(bell(carolHome)).toHaveAccessibleName('Thông báo')
  } finally {
    await Promise.all([alice.context.close(), bob.context.close(), carol.context.close()])
  }
})

test('F14 + F11 + F15: sửa/xoá/cảm xúc đồng bộ, nội dung độc hại hiển thị dạng text, gửi ảnh/PDF, chặn file quá lớn và người ngoài', async ({ browser }) => {
  const [alice, bob, outsider] = await Promise.all([account(browser, 'alice'), account(browser, 'bob'), account(browser, 'outsider')])
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)
    const count = (p: Page) => p.locator('.message').count()

    // ---- F14: sửa ----
    await send(a, 'Bản nháp đầu tiên')
    await expect(b.getByText('Bản nháp đầu tiên')).toBeVisible()
    const before = await count(b)
    await bubble(a, 'Bản nháp đầu tiên').hover()
    await bubble(a, 'Bản nháp đầu tiên').getByRole('button', { name: 'Sửa tin nhắn' }).click()
    await a.getByRole('textbox', { name: 'Sửa tin nhắn' }).fill('Bản đã sửa')
    await a.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(bubble(b, 'Bản đã sửa')).toContainText('(đã sửa)')
    expect(await count(b)).toBe(before) // thay tại chỗ, không thêm tin
    // Bob không có nút sửa/xoá tin của Alice.
    await bubble(b, 'Bản đã sửa').hover()
    await expect(bubble(b, 'Bản đã sửa').getByRole('button', { name: 'Sửa tin nhắn' })).toHaveCount(0)

    // ---- F14: cảm xúc (gửi lại cùng trạng thái không đảo) ----
    await bubble(b, 'Bản đã sửa').getByRole('button', { name: 'Thả cảm xúc' }).click()
    await b.getByRole('button', { name: 'Thả 👍' }).click()
    await expect(bubble(a, 'Bản đã sửa').getByRole('button', { name: '👍 1' })).toBeVisible()
    await bubble(b, 'Bản đã sửa').getByRole('button', { name: /👍 1, bạn đã thả/ }).click() // bỏ cảm xúc
    await expect(bubble(a, 'Bản đã sửa').locator('.reaction-chip')).toHaveCount(0)

    // ---- F14: xoá (mềm, còn đúng trong lịch sử) ----
    await bubble(a, 'Bản đã sửa').hover()
    await bubble(a, 'Bản đã sửa').getByRole('button', { name: 'Xoá tin nhắn' }).click()
    await a.getByRole('button', { name: 'Xoá', exact: true }).click()
    await expect(b.getByText('Tin nhắn đã bị xoá')).toBeVisible()
    await b.reload()
    await expect(b.getByText('Tin nhắn đã bị xoá')).toBeVisible()
    await expect(b.getByText('Bản đã sửa')).toHaveCount(0)

    // ---- F11: nội dung độc hại chỉ là text ----
    const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'
    await send(a, xss)
    await expect(b.getByText(xss)).toBeVisible()
    expect(await b.locator('.message-list img').count()).toBe(0)
    expect(await b.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()

    // ---- F15: chặn file quá 5 MB ngay ở client (không gửi request upload) ----
    let uploads = 0
    a.on('request', (r) => { if (r.url().endsWith('/api/uploads') && r.method() === 'POST') uploads++ })
    await a.getByTestId('file-input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await expect(a.getByText(/vượt quá giới hạn 5 MB/)).toBeVisible()
    await a.getByRole('button', { name: 'Bỏ tệp đính kèm' }).click()
    expect(uploads).toBe(0)

    // ---- F15: ảnh PNG → người nhận thấy ảnh ngay (realtime), tải qua Bearer ----
    await a.getByTestId('file-input').setInputFiles({ name: 'so-do.png', mimeType: 'image/png', buffer: png(32, 16) })
    await expect(a.getByText('Sẵn sàng gửi')).toBeVisible()
    await send(a, 'Ảnh sơ đồ')
    const img = b.getByRole('img', { name: 'so-do.png' })
    await expect(img).toBeVisible()
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(32)
    expect(uploads).toBe(1)

    // ---- F15: PDF, gửi chỉ file không kèm chữ ----
    await a.getByTestId('file-input').setInputFiles({ name: 'bao-cao.pdf', mimeType: 'application/pdf', buffer: pdf })
    await expect(a.getByText('Sẵn sàng gửi')).toBeVisible()
    await a.getByRole('button', { name: 'Gửi', exact: true }).click()
    await expect(b.getByRole('button', { name: /bao-cao\.pdf/ })).toBeVisible()
    const download = b.waitForEvent('download')
    await b.getByRole('button', { name: /bao-cao\.pdf/ }).click()
    expect((await download).suggestedFilename()).toBe('bao-cao.pdf')

    // Người ngoài phòng không tải được file dù biết URL.
    const page = await (await alice.context.request.get(`/api/rooms/${roomId}/messages`, { headers: { Authorization: `Bearer ${alice.token}` } })).json()
    const url = page.messages.find((m: { attachment?: { filename: string } }) => m.attachment?.filename === 'so-do.png').attachment.url
    expect((await outsider.context.request.get(url, { headers: { Authorization: `Bearer ${outsider.token}` } })).status()).toBe(403)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close(), outsider.context.close()])
  }
})

test('F10 + F11: tin gửi khi offline được gửi bù đúng thứ tự, không trùng; gửi quá nhanh thì tự chờ rồi gửi đủ', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)
    const shown = (p: Page, prefix: string) =>
      p.locator('.message-content').evaluateAll((els, pre) => els.map((e) => e.textContent ?? '').filter((t) => t.startsWith(pre)), prefix)

    // ---- F10: offline (sau khi lịch sử đã tải: ô soạn tin cần có lịch sử để chèn bản tạm) ----
    await expect(box(a)).toBeEnabled()
    await expect(box(b)).toBeEnabled()
    await b.context().setOffline(true)
    await expect(b.locator('.connection-banner')).toBeVisible({ timeout: 15_000 })
    for (const i of [1, 2, 3]) await send(b, `offline-${i}`)
    await expect(b.getByText('3 tin đang chờ', { exact: false })).toBeVisible()
    await b.waitForTimeout(1_000)
    expect(await shown(a, 'offline-')).toEqual([]) // chưa tới được Alice
    await b.context().setOffline(false)
    await expect.poll(() => shown(a, 'offline-'), { timeout: 30_000 }).toEqual(['offline-1', 'offline-2', 'offline-3'])
    await expect(b.getByText('Chờ kết nối để gửi…')).toHaveCount(0)
    // Sau khi tải lại, lịch sử (REST) có đúng 3 tin, đúng thứ tự, không trùng.
    await b.reload()
    await expect.poll(() => shown(b, 'offline-')).toEqual(['offline-1', 'offline-2', 'offline-3'])

    // ---- F11: 12 tin liên tục > 10 tin / 5 s → tự chờ rồi gửi đủ, đúng thứ tự, không lỗi ----
    await expect(b.getByText('Đã kết nối', { exact: true })).toBeVisible()
    for (let i = 1; i <= 12; i++) await send(b, `burst-${String(i).padStart(2, '0')}`)
    await expect(b.getByText(/Bạn gửi quá nhanh/).first()).toBeVisible()
    const expected = Array.from({ length: 12 }, (_, k) => `burst-${String(k + 1).padStart(2, '0')}`)
    await expect.poll(() => shown(a, 'burst-'), { timeout: 30_000 }).toEqual(expected)
    await expect(b.getByText(/Gửi lỗi/)).toHaveCount(0)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
