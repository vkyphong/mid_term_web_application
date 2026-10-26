import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

/** F06 presence, F07 typing, F08 receipts trên backend thật. */

interface Frame { type: string; payload: Record<string, unknown> }

/** Ghi lại các event STOMP nhận được (typing:*, presence:update, message:*). */
function watchEvents(page: Page): Frame[] {
  const frames: Frame[] = []
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      for (const raw of payload.toString().split('\0')) {
        const start = raw.indexOf('\n\n')
        if (!raw.startsWith('MESSAGE') || start < 0) continue
        try {
          const body = JSON.parse(raw.slice(start + 2))
          if (body.type && body.type !== 'ack') frames.push(body)
        } catch { /* heartbeat / frame khác */ }
      }
    }),
  )
  return frames
}

/** Đếm frame SEND theo type mà trang này gửi lên. */
function watchSends(page: Page): string[] {
  const sent: string[] = []
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      const raw = payload.toString()
      const start = raw.indexOf('\n\n')
      if (!raw.startsWith('SEND') || start < 0) return
      try { sent.push(JSON.parse(raw.slice(start + 2).replace(/\0/g, '')).type) } catch { /* bỏ qua */ }
    }),
  )
  return sent
}

async function account(browser: Browser, label: string) {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const displayName = `E2E ${label} ${crypto.randomUUID().slice(0, 6)}`
  const response = await context.request.post('/api/auth/register', {
    data: { email: `e2e-rt-${label}-${crypto.randomUUID()}@DQGM.dev`, displayName, password: 'Password123' },
  })
  expect(response.status()).toBe(201)
  const auth = await response.json()
  return { context, displayName, id: auth.user.id as string, token: auth.accessToken as string }
}

async function open(context: BrowserContext, path: string) {
  const page = await context.newPage()
  const frames = watchEvents(page)
  const sends = watchSends(page)
  await page.goto(path)
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  return { page, frames, sends }
}

test('F06/F07/F08: presence nhiều tab, typing không lộ sang phòng khác, receipts DM đủ 3 trạng thái', async ({ browser }) => {
  const alice = await account(browser, 'alice')
  const bob = await account(browser, 'bob')
  const carol = await account(browser, 'carol')
  try {
    const dmRes = await alice.context.request.post('/api/dms', {
      data: { userId: bob.id }, headers: { Authorization: `Bearer ${alice.token}` },
    })
    expect(dmRes.status()).toBe(200)
    const dmId = (await dmRes.json()).id as string

    // ---------- F06: presence với nhiều tab ----------
    const bobDm = await open(bob.context, `/rooms/${dmId}`)
    const status = bobDm.page.locator('.room-title p')
    await expect(status).toContainText('Chưa hoạt động')

    const aliceTab1 = await open(alice.context, `/rooms/${dmId}`)
    await expect(status).toContainText('Đang hoạt động')
    const aliceTab2 = await open(alice.context, '/')
    await aliceTab1.page.close()
    await bobDm.page.waitForTimeout(1_500)
    await expect(status).toContainText('Đang hoạt động') // còn tab 2 → vẫn online
    await aliceTab2.page.close()
    await expect(status).toContainText('Vừa hoạt động') // đóng tab cuối → offline + lastSeen

    // Reconnect không tạo trạng thái dư: snapshot có đúng 1 bản ghi cho Alice và đang online.
    const alicePage = await open(alice.context, `/rooms/${dmId}`)
    await expect(status).toContainText('Đang hoạt động')
    const snapshot = await (await bob.context.request.get('/api/presence', { headers: { Authorization: `Bearer ${bob.token}` } })).json()
    const aliceRows = snapshot.users.filter((u: { userId: string }) => u.userId === alice.id)
    expect(aliceRows).toEqual([expect.objectContaining({ userId: alice.id, online: true })])

    // ---------- F07: typing ----------
    const carolPage = await open(carol.context, '/')
    const box = alicePage.page.getByRole('textbox', { name: 'Nội dung tin nhắn' })
    const typingStarts = () => alicePage.sends.filter((t) => t === 'typing:start').length
    for (let i = 0; i < 16; i++) {
      await box.pressSequentially('a')
      await alicePage.page.waitForTimeout(250) // gõ liên tục 4 giây
    }
    await expect(bobDm.page.getByText(`${alice.displayName} đang gõ…`)).toBeVisible()
    expect(typingStarts()).toBeGreaterThanOrEqual(2)
    expect(typingStarts()).toBeLessThanOrEqual(3) // throttle 2 s, không gửi theo từng phím
    // Ngừng gõ → chỉ báo biến mất (typing:stop sau 2,5 s, hoặc TTL 3 s).
    await expect(bobDm.page.getByText(`${alice.displayName} đang gõ…`)).toBeHidden({ timeout: 5_000 })
    // Carol không thuộc DM → không nhận bất kỳ frame typing nào của phòng này.
    expect(carolPage.frames.filter((f) => f.type.startsWith('typing:'))).toEqual([])
    await box.fill('')

    // ---------- F08: receipts trong DM ----------
    // Bob offline → chỉ "Đã gửi".
    await bobDm.page.close()
    await box.fill('Tin 0: Bob đang offline')
    await alicePage.page.keyboard.press('Enter')
    const receipt = alicePage.page.locator('.message-receipt')
    await expect(receipt).toHaveText('Đã gửi')

    // Bob online ở trang chủ: không xem hội thoại.
    const bobHome = await open(bob.context, '/')
    await alicePage.page.waitForTimeout(1_000)
    await expect(receipt).toHaveText('Đã gửi')
    await box.fill('Tin 1: Bob nhận nhưng chưa xem')
    await alicePage.page.keyboard.press('Enter')
    await expect(receipt).toHaveText('Đã nhận') // client của Bob gửi delivered khi nhận message:new
    await alicePage.page.waitForTimeout(1_500)
    await expect(receipt).toHaveText('Đã nhận') // chưa mở hội thoại → không được thành "Đã xem"

    await bobHome.page.goto(`/rooms/${dmId}`)
    await expect(bobHome.page.getByText('Tin 1: Bob nhận nhưng chưa xem')).toBeVisible()
    await expect(receipt).toHaveText('Đã xem')

    // Sự kiện trùng / nhiều tab không làm lùi trạng thái: Bob mở thêm tab và tải lại.
    const bobTab2 = await open(bob.context, `/rooms/${dmId}`)
    await bobTab2.page.reload()
    await expect(bobTab2.page.getByText('Tin 1: Bob nhận nhưng chưa xem')).toBeVisible()
    await alicePage.page.waitForTimeout(1_000)
    await expect(receipt).toHaveText('Đã xem')

    // Người gửi không tự gửi receipt cho tin của mình.
    expect(alicePage.sends.filter((t) => t === 'message:seen' || t === 'message:delivered')).toEqual([])
  } finally {
    await alice.context.close()
    await bob.context.close()
    await carol.context.close()
  }
})
