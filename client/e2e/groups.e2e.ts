import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { personName } from './people'
import { crc32, deflateSync } from 'node:zlib'

/** Nhóm: tạo kèm thành viên, thêm người, @All, thanh công cụ soạn tin, file Office/TXT/CSV/ZIP, nhóm lưu trữ — backend thật. */

interface Account { context: BrowserContext; id: string; token: string; displayName: string }

async function account(browser: Browser, label: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const displayName = personName()
  const res = await context.request.post('/api/auth/register', {
    data: { email: `e2e-grp-${label}-${crypto.randomUUID()}@DQGM.dev`, displayName, password: 'Password123' },
  })
  expect(res.status()).toBe(201)
  const auth = await res.json()
  return { context, id: auth.user.id, token: auth.accessToken, displayName }
}

const auth = (acc: Account) => ({ Authorization: `Bearer ${acc.token}` })

async function open(acc: Account, path: string): Promise<Page> {
  const page = await acc.context.newPage()
  await page.goto(path)
  await expect(page.getByText('Đã kết nối', { exact: true })).toBeVisible()
  return page
}

/** Kênh tạo qua API, thêm thành viên bằng POST /api/rooms/{id}/members (không cần họ tự tham gia). */
async function channelWith(owner: Account, ...members: Account[]) {
  const res = await owner.context.request.post('/api/rooms', {
    data: { name: `E2E-grp-${crypto.randomUUID().slice(0, 8)}` }, headers: auth(owner),
  })
  expect(res.status()).toBe(201)
  const roomId = (await res.json()).id as string
  for (const m of members) {
    const added = await owner.context.request.post(`/api/rooms/${roomId}/members`, { data: { userId: m.id }, headers: auth(owner) })
    expect(added.status()).toBe(200)
  }
  return roomId
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Nội dung tin nhắn' })
const bubble = (page: Page, text: string) => page.locator('.message-list .message', { hasText: text })

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
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x3c)
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** ZIP không nén (đủ để BE đọc được directory), dùng dựng DOCX tối thiểu. */
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const fileName = Buffer.from(name)
    const crc = crc32(data) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(fileName.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(fileName.length, 28); entry.writeUInt32LE(offset, 42)
    local.push(header, fileName, data)
    central.push(entry, fileName)
    offset += header.length + fileName.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  const count = Object.keys(files).length
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

const docx = () =>
  zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Báo cáo tuần</w:t></w:r></w:p></w:body></w:document>',
  })

test('tạo nhóm kèm thành viên, @All báo cả nhóm, thêm người từ thanh công cụ, gửi nhanh 👍', async ({ browser }) => {
  const [alice, bob, carol, dan] = await Promise.all(['alice', 'bob', 'carol', 'dan'].map((l) => account(browser, l)))
  try {
    const a = await open(alice, '/')
    // Bob, Carol, Dan mở app sẵn từ trước: nhóm phải tự hiện khi họ được thêm, không cần tải lại.
    const [bobHome, carolHome, danHome] = await Promise.all([open(bob, '/'), open(carol, '/'), open(dan, '/')])
    const sidebarLink = (page: Page) => page.getByRole('navigation', { name: 'Danh sách phòng' }).getByRole('link', { name })
    const name = `Nhóm ${crypto.randomUUID().slice(0, 6)}`

    // Tạo kênh và chọn sẵn Bob, Carol như tạo nhóm trên Zalo.
    await a.getByRole('button', { name: 'Tạo kênh', exact: true }).click()
    const create = a.getByRole('dialog', { name: 'Tạo kênh mới' })
    await create.getByLabel('Tên kênh').fill(name)
    for (const m of [bob, carol]) {
      await create.getByRole('searchbox', { name: 'Tìm nhân viên' }).fill(m.displayName)
      await create.getByRole('checkbox', { name: new RegExp(m.displayName) }).check()
    }
    await create.getByRole('button', { name: 'Tạo kênh với 2 thành viên', exact: true }).click()
    await expect(a.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(a.locator('.room-title p')).toHaveText('3 thành viên')
    const roomId = a.url().split('/rooms/')[1]

    // Bob đã ở trong nhóm, không cần bấm tham gia.
    const bobRooms = await bob.context.request.get('/api/rooms', { headers: auth(bob) })
    expect((await bobRooms.json()).rooms.find((r: { id: string }) => r.id === roomId)).toMatchObject({ joined: true, memberCount: 3 })
    for (const page of [bobHome, carolHome]) {
      await expect(sidebarLink(page)).toBeVisible()
      await expect(page.locator('.toast', { hasText: 'Bạn đã được thêm vào nhóm' })).toContainText(`#${name}`)
    }
    await expect(sidebarLink(danHome)).toHaveCount(0)

    // Nút @ trên thanh công cụ → @All đứng đầu → gửi: mọi thành viên khác nhận thông báo.
    await expect(box(a)).toBeEnabled()
    await box(a).fill('Họp lúc 9h')
    await a.getByRole('button', { name: 'Nhắc tên thành viên' }).click()
    await expect(a.getByRole('option').first()).toContainText('Báo cho cả nhóm (2 người)')
    await a.getByRole('option').first().click()
    await expect(box(a)).toHaveValue('Họp lúc 9h @All ')
    await a.keyboard.press('Enter')
    await expect(bubble(a, 'Họp lúc 9h').locator('.mention')).toHaveText('@All')
    for (const page of [bobHome, carolHome]) {
      await expect(page.locator('.toast', { hasText: 'Bạn được nhắc đến' })).toContainText('Họp lúc 9h @All')
    }

    // Emoji từ bảng biểu tượng.
    await box(a).fill('Chốt ')
    await a.getByRole('button', { name: 'Biểu tượng cảm xúc' }).click()
    await a.getByRole('button', { name: 'Chèn 🎉' }).click()
    await a.keyboard.press('Enter')
    await expect(bubble(a, 'Chốt 🎉')).toBeVisible()

    // Thêm Dan từ thanh công cụ; người đã trong nhóm không chọn được.
    await a.getByRole('toolbar', { name: 'Công cụ soạn tin' }).getByRole('button', { name: 'Thêm thành viên' }).click()
    const add = a.getByRole('dialog', { name: `Thêm thành viên vào #${name}` })
    await add.getByRole('searchbox', { name: 'Tìm nhân viên' }).fill(bob.displayName)
    await expect(add.getByRole('checkbox', { name: new RegExp(bob.displayName) })).toBeDisabled()
    await add.getByRole('searchbox', { name: 'Tìm nhân viên' }).fill(dan.displayName)
    await add.getByRole('checkbox', { name: new RegExp(dan.displayName) }).check()
    await add.getByRole('button', { name: 'Thêm 1 người', exact: true }).click()
    await expect(add).toHaveCount(0)
    await expect(a.locator('.room-title p')).toHaveText('4 thành viên')

    // Dan thấy nhóm ngay; bấm thông báo mở nhóm, thấy lịch sử và nhận 👍 gửi nhanh realtime.
    await expect(sidebarLink(danHome)).toBeVisible()
    await danHome.locator('.toast', { hasText: 'Bạn đã được thêm vào nhóm' }).getByRole('button').first().click()
    const d = danHome
    await expect(d).toHaveURL(new RegExp(`/rooms/${roomId}$`))
    await expect(bubble(d, 'Họp lúc 9h')).toBeVisible()
    await a.getByRole('button', { name: 'Gửi nhanh 👍' }).click()
    await expect(d.locator('.message-list .message-content', { hasText: /^👍$/ })).toBeVisible()
  } finally {
    await Promise.all([alice, bob, carol, dan].map((acc) => acc.context.close()))
  }
})

test('gửi file Word, CSV, TXT, ZIP; chặn định dạng không hỗ trợ trước khi upload', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)
    const files = [
      { name: 'bao-cao.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx() },
      // Windows báo CSV là application/vnd.ms-excel: FE vẫn nhận theo đuôi file.
      { name: 'so-lieu.csv', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('ten,diem\nAn,9\n') },
      { name: 'ghi-chu.txt', mimeType: 'text/plain', buffer: Buffer.from('Ghi chú cuộc họp') },
      { name: 'tai-lieu.zip', mimeType: 'application/x-zip-compressed', buffer: zip({ 'readme.txt': 'xin chao' }) },
    ]
    for (const file of files) {
      await a.getByTestId('file-input').setInputFiles(file)
      await expect(a.getByText('Sẵn sàng gửi', { exact: true })).toBeVisible()
      await a.getByRole('button', { name: 'Gửi', exact: true }).click()
      await expect(b.locator('.message-list .attachment-name', { hasText: file.name })).toBeVisible()
    }

    // Thông tin nhóm: mục File liệt kê file đã gửi, mục Link liệt kê link trong tin nhắn.
    await box(a).fill('Tài liệu tại https://example.com/tai-lieu nhé')
    await a.keyboard.press('Enter')
    await b.getByRole('button', { name: 'Thông tin nhóm' }).click()
    const info = b.getByRole('dialog', { name: 'Thông tin nhóm' })
    await expect(info.getByRole('region', { name: 'File' })).toContainText('tai-lieu.zip')
    await info.getByRole('region', { name: 'File' }).getByRole('button', { name: 'Xem tất cả' }).click()
    const allFiles = b.getByRole('dialog', { name: 'File' })
    for (const file of files) await expect(allFiles).toContainText(file.name)
    await allFiles.getByRole('button', { name: '← Thông tin nhóm' }).click()
    await expect(info.getByRole('region', { name: 'Link' })).toContainText('example.com')
    await b.keyboard.press('Escape')

    const download = b.waitForEvent('download')
    await b.locator('.attachment-file', { hasText: 'bao-cao.docx' }).click()
    expect((await download).suggestedFilename()).toBe('bao-cao.docx')

    let uploads = 0
    a.on('request', (r) => { if (r.url().includes('/api/uploads') && r.method() === 'POST') uploads++ })
    await a.getByTestId('file-input').setInputFiles({ name: 'cu.doc', mimeType: 'application/msword', buffer: Buffer.from('x') })
    await expect(a.getByText(/Chỉ hỗ trợ ảnh JPG\/PNG, PDF, TXT, CSV, Word, Excel, PowerPoint hoặc ZIP/)).toBeVisible()
    await a.getByTestId('image-input').setInputFiles({ name: 'bao-cao.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') })
    await expect(a.getByText('Chỉ gửi được ảnh JPG hoặc PNG.', { exact: true })).toBeVisible()
    expect(uploads).toBe(0)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})

test('nhóm bị admin lưu trữ: vẫn đọc lịch sử, không còn ô soạn tin, BE chặn gửi file', async ({ browser }) => {
  const email = process.env.ADMIN_TEST_EMAIL
  const password = process.env.ADMIN_TEST_PASSWORD
  test.skip(!email || !password, 'Set ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD to run against a real admin account.')
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  const admin = await browser.newContext({ baseURL: 'http://localhost:8080' })
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    await box(a).fill('Tin trước khi lưu trữ')
    await a.keyboard.press('Enter')
    await expect(bubble(a, 'Tin trước khi lưu trữ')).toBeVisible()

    const login = await admin.request.post('/api/auth/login', { data: { email, password } })
    expect(login.status()).toBe(200)
    const adminToken = (await login.json()).accessToken
    const archived = await admin.request.post(`/api/admin/groups/${roomId}/archive`, {
      data: { archived: true }, headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(archived.status()).toBe(200)

    const b = await open(bob, `/rooms/${roomId}`)
    await expect(bubble(b, 'Tin trước khi lưu trữ')).toBeVisible()
    await expect(b.locator('.room-title').getByText('Đã lưu trữ', { exact: true })).toBeVisible()
    await expect(b.getByText(/Nhóm đã được lưu trữ/)).toBeVisible()
    await expect(box(b)).toHaveCount(0)
    await expect(b.getByRole('button', { name: 'Thêm thành viên' })).toHaveCount(0)

    const upload = await bob.context.request.post('/api/uploads', {
      headers: auth(bob), multipart: { roomId, file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } },
    })
    expect(upload.status()).toBe(409)
    expect((await upload.json()).error.reason).toBe('room_archived')
  } finally {
    await Promise.all([alice.context.close(), bob.context.close(), admin.close()])
  }
})

test('tin chưa đọc: vòng tròn đỏ đếm tới 5+, còn sau khi tải lại, mất khi mở phòng; có âm báo', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    const roomId = await channelWith(alice, bob)
    const otherRoom = await channelWith(bob)
    // Đếm số lần phát âm báo (mỗi tiếng "ting" tạo 2 oscillator).
    await bob.context.addInitScript(() => {
      const w = window as unknown as { __chimes: number }
      w.__chimes = 0
      const original = AudioContext.prototype.createOscillator
      AudioContext.prototype.createOscillator = function (this: AudioContext) {
        w.__chimes++
        return original.call(this)
      }
    })
    // Tin 1 gửi khi Bob chưa mở app: số chưa đọc lấy từ server.
    const a = await open(alice, `/rooms/${roomId}`)
    await box(a).fill('Tin 1')
    await a.keyboard.press('Enter')
    await expect(bubble(a, 'Tin 1')).toBeVisible()

    const b = await open(bob, `/rooms/${otherRoom}`)
    const link = b.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${roomId}"]`)
    await expect(link.locator('.unread-badge')).toHaveText('1')
    await expect(b).toHaveTitle('(1) Tập Đoàn M Chat')
    await b.locator('.composer textarea').click() // tương tác đầu tiên để trình duyệt cho phát âm thanh

    await box(a).fill('Tin 2')
    await a.keyboard.press('Enter')
    await expect(link.locator('.unread-badge')).toHaveText('2')
    await expect.poll(() => b.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBeGreaterThan(0)
    // Tin nhắn không vào chuông.
    await expect(b.getByRole('button', { name: /^Thông báo/ })).toHaveAccessibleName('Thông báo')

    for (const i of [3, 4, 5, 6]) {
      await box(a).fill(`Tin ${i}`)
      await a.keyboard.press('Enter')
    }
    await expect(link.locator('.unread-badge')).toHaveText('5+')
    await expect(link.locator('.unread-badge')).toHaveCSS('background-color', 'rgb(229, 57, 53)')

    await b.reload()
    await expect(link.locator('.unread-badge')).toHaveText('5+')

    await link.click()
    await expect(bubble(b, 'Tin 6')).toBeVisible()
    await expect(link.locator('.unread-badge')).toHaveCount(0)
    await expect(b).toHaveTitle('Tập Đoàn M Chat')
    // Receipts "đã xem" lên server (lần lượt 250 ms/tin) → tải lại vẫn không còn số.
    await expect.poll(async () => {
      const rooms = (await (await bob.context.request.get('/api/rooms', { headers: auth(bob) })).json()).rooms
      return rooms.find((r: { id: string }) => r.id === roomId).unreadCount
    }).toBe(0)
    await b.goto(`/rooms/${otherRoom}`)
    await expect(b.getByText('Đã kết nối', { exact: true })).toBeVisible()
    await expect(link).toBeVisible()
    await expect(link.locator('.unread-badge')).toHaveCount(0)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})

test('đổi tên nhóm, ảnh nhóm thấy ngay ở mọi thành viên; biệt danh DM chỉ người đặt thấy; avatar ghép thay dấu #', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, '/')
    const bobLink = b.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${roomId}"]`)

    // Avatar mặc định: ghép avatar thành viên, không còn dấu #.
    await expect(bobLink.locator('.group-avatar--n2 .avatar')).toHaveCount(2)
    await expect(a.locator('.room-hash')).toHaveCount(0)

    // Đổi tên nhóm → Bob thấy ngay không cần tải lại.
    const newName = `Nhóm mới ${crypto.randomUUID().slice(0, 6)}`
    await a.getByRole('button', { name: 'Đổi tên nhóm' }).click()
    const rename = a.getByRole('dialog', { name: 'Đổi tên nhóm' })
    await rename.getByLabel('Tên nhóm').fill(newName)
    await rename.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(a.getByRole('heading', { level: 1, name: newName })).toBeVisible()
    await expect(bobLink).toContainText(newName)

    // Ảnh nhóm → hiện ở cả hai người.
    await a.getByRole('button', { name: 'Thông tin nhóm' }).click()
    const info = a.getByRole('dialog', { name: 'Thông tin nhóm' })
    await expect(info.getByRole('button', { name: 'Đổi ảnh nhóm' })).toBeVisible()
    await a.getByTestId('group-avatar-input').setInputFiles({ name: 'nhom.png', mimeType: 'image/png', buffer: png(8, 8) })
    await expect(a.locator('.room-header .group-avatar-image')).toBeVisible()
    await expect(bobLink.locator('.group-avatar-image')).toBeVisible()
    // Quay lại ảnh ghép.
    await info.getByRole('button', { name: 'Dùng ảnh ghép thành viên' }).click()
    await a.keyboard.press('Escape')
    await expect(bobLink.locator('.group-avatar-image')).toHaveCount(0)
    await expect(bobLink.locator('.group-avatar--n2')).toBeVisible()

    // Biệt danh trong DM: Alice đặt cho Bob, chỉ Alice thấy.
    const dm = await (await alice.context.request.post('/api/dms', { data: { userId: bob.id }, headers: auth(alice) })).json()
    await a.goto(`/rooms/${dm.id}`)
    await a.getByRole('button', { name: 'Đổi biệt danh' }).click()
    const nick = a.getByRole('dialog', { name: 'Đổi biệt danh' })
    await nick.getByLabel('Biệt danh').fill('Bạn Bob')
    await nick.getByRole('button', { name: 'Lưu', exact: true }).click()
    await expect(a.getByRole('heading', { level: 1, name: 'Bạn Bob' })).toBeVisible()
    await expect(a.locator('.room-title p')).toContainText(`Tên thật: ${bob.displayName}`)
    await expect(a.locator('.room-title p')).not.toContainText('@')
    await expect(a.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${dm.id}"]`)).toContainText('Bạn Bob')
    await a.reload()
    await expect(a.getByRole('heading', { level: 1, name: 'Bạn Bob' })).toBeVisible()
    const bobDm = await open(bob, `/rooms/${dm.id}`)
    await expect(bobDm.getByRole('heading', { level: 1, name: alice.displayName })).toBeVisible()
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})

test('bình chọn realtime, tìm tin cũ và nhảy tới, trưởng nhóm bổ nhiệm phó nhóm, ảnh đại diện tài khoản', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    // Alice tạo kênh qua API → là trưởng nhóm.
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)

    // ---- Tìm tin: tin cần tìm bị đẩy ra ngoài trang 30 tin đầu ----
    await box(a).fill('Báo cáo quý 1 đã nộp')
    await a.keyboard.press('Enter')
    for (let i = 0; i < 31; i++) {
      await box(a).fill(`Tin thường ${i}`)
      await a.keyboard.press('Enter')
    }
    await expect(bubble(b, 'Tin thường 30')).toBeVisible({ timeout: 40_000 })
    await b.reload()
    await expect(bubble(b, 'Tin thường 30')).toBeVisible()
    await expect(bubble(b, 'Báo cáo quý 1')).toHaveCount(0) // chưa tải trang cũ
    await b.getByRole('button', { name: 'Tìm tin nhắn' }).click()
    // Ô tìm nằm ngang hàng với icon 🔍 trong đầu phòng.
    const field = await b.locator('.room-search-field').boundingBox()
    const header = await b.locator('.room-header').boundingBox()
    expect(field!.y).toBeGreaterThanOrEqual(header!.y)
    expect(field!.y + field!.height).toBeLessThanOrEqual(header!.y + header!.height)
    await b.getByLabel('Từ khoá').fill('báo cáo')
    const result = b.getByRole('search', { name: 'Tìm tin nhắn' }).getByRole('button', { name: /Báo cáo quý 1 đã nộp/ })
    await expect(result.locator('mark')).toHaveText('Báo cáo')
    await result.click()
    await expect(bubble(b, 'Báo cáo quý 1 đã nộp')).toBeInViewport()
    await expect(b.locator('.message--highlight')).toContainText('Báo cáo quý 1 đã nộp')

    // ---- Trưởng / phó nhóm ----
    await expect(b.locator('.message-list .message-gutter .role-key--owner').first()).toBeVisible()
    await a.getByRole('button', { name: '2 thành viên' }).click()
    const members = a.getByRole('dialog', { name: 'Thành viên (2)' })
    await expect(members.locator('li', { hasText: alice.displayName })).toContainText('Trưởng nhóm')
    await members.locator('li', { hasText: bob.displayName }).getByRole('button', { name: 'Bổ nhiệm phó nhóm' }).click()
    await expect(members.locator('li', { hasText: bob.displayName })).toContainText('Phó nhóm')
    await a.keyboard.press('Escape')
    const bobView = await (await bob.context.request.get(`/api/rooms/${roomId}/members`, { headers: auth(bob) })).json()
    expect(bobView.members.find((m: { id: string }) => m.id === bob.id).memberRole).toBe('deputy')
    await b.getByRole('button', { name: '2 thành viên' }).click()
    await expect(b.getByRole('dialog').getByRole('button', { name: /phó nhóm/ })).toHaveCount(0) // phó nhóm không phân quyền được
    await b.keyboard.press('Escape')

    // ---- Bình chọn ----
    await a.getByRole('button', { name: 'Tạo bình chọn' }).click()
    const create = a.getByRole('dialog', { name: 'Tạo bình chọn' })
    await create.getByLabel('Câu hỏi').fill('Ăn trưa ở đâu?')
    await create.getByLabel('Lựa chọn 1', { exact: true }).fill('Cơm')
    await create.getByLabel('Lựa chọn 2', { exact: true }).fill('Phở')
    await create.getByRole('button', { name: '+ Thêm lựa chọn' }).click()
    await create.getByLabel('Lựa chọn 3', { exact: true }).fill('Bún')
    await create.getByRole('button', { name: 'Tạo bình chọn' }).click()
    const bobPoll = b.getByRole('group', { name: 'Bình chọn: Ăn trưa ở đâu?' })
    await expect(bobPoll.getByRole('checkbox')).toHaveCount(3)
    // Bình chọn nằm giữa khung chat; Bob thấy tên người tạo, Alice (người tạo) thì không.
    await expect(b.locator('.message--poll .poll-caption')).toHaveText(`${alice.displayName} đã tạo cuộc bình chọn`)
    await expect(a.locator('.message--poll .poll-caption')).toHaveCount(0)
    const card = await bobPoll.boundingBox()
    const list = await b.locator('.message-scroller').boundingBox()
    expect(Math.abs(card!.x + card!.width / 2 - (list!.x + list!.width / 2))).toBeLessThan(24)
    await bobPoll.getByRole('checkbox', { name: 'Phở: 0 phiếu' }).click()
    const alicePoll = a.getByRole('group', { name: 'Bình chọn: Ăn trưa ở đâu?' })
    await expect(alicePoll.getByRole('checkbox', { name: 'Phở: 1 phiếu' })).toBeVisible()
    await alicePoll.getByRole('checkbox', { name: 'Phở: 1 phiếu' }).hover()
    await expect(alicePoll.locator('.reaction-who')).toHaveText(bob.displayName)

    // Dòng hoạt động: Alice thấy "Bob đã bình chọn: …  Xem".
    const voteLine = a.locator('.activity-line', { hasText: 'đã bình chọn' })
    await expect(voteLine).toContainText(`${bob.displayName} đã bình chọn: Ăn trưa ở đâu?`)
    await expect(voteLine.getByRole('button', { name: 'Xem' })).toBeVisible()
    // Khoá bình chọn: Alice (người tạo) và Bob (phó nhóm) đều thấy nút; Bob khoá.
    await expect(alicePoll.getByRole('button', { name: 'Khoá bình chọn' })).toBeVisible()
    await bobPoll.getByRole('button', { name: 'Khoá bình chọn' }).click()
    await expect(alicePoll).toContainText('Đã khoá bình chọn')
    await expect(alicePoll.getByRole('checkbox', { name: 'Cơm: 0 phiếu' })).toBeDisabled()
    await expect(a.locator('.activity-line', { hasText: 'đã khoá bình chọn' })).toContainText(bob.displayName)
    // Mở lại: Alice (người tạo) bấm "Mở lại", Bob bình chọn tiếp được; khoá / mở thoải mái.
    await alicePoll.getByRole('button', { name: 'Mở lại bình chọn' }).click()
    await expect(bobPoll.getByRole('checkbox', { name: 'Cơm: 0 phiếu' })).toBeEnabled()
    await expect(b.locator('.activity-line', { hasText: 'đã mở lại bình chọn' })).toContainText(alice.displayName)
    await bobPoll.getByRole('checkbox', { name: 'Cơm: 0 phiếu' }).click()
    await expect(alicePoll.getByRole('checkbox', { name: 'Cơm: 1 phiếu' })).toBeVisible()
    await alicePoll.getByRole('button', { name: 'Khoá bình chọn' }).click()
    await expect(bobPoll).toContainText('Đã khoá bình chọn')

    // ---- Hồ sơ riêng tư / công khai: Alice bấm avatar Bob trong danh sách thành viên ----
    await bob.context.request.put('/api/me/profile', { headers: auth(bob), data: { displayName: bob.displayName, gender: 'male', birthDate: '2000-02-03', phone: '0901 234 567' } })
    await a.getByRole('button', { name: '2 thành viên' }).click()
    await a.getByRole('button', { name: `Xem thông tin ${bob.displayName}` }).click()
    const bobProfile = a.getByRole('dialog', { name: 'Thông tin tài khoản' })
    await expect(bobProfile).toContainText('chế độ riêng tư')
    await expect(bobProfile).not.toContainText('0901 234 567')
    await a.keyboard.press('Escape')
    await bob.context.request.put('/api/me/profile', { headers: auth(bob), data: { displayName: bob.displayName, gender: 'male', birthDate: '2000-02-03', phone: '0901 234 567', profilePublic: true } })
    await a.getByRole('button', { name: '2 thành viên' }).click()
    await a.getByRole('button', { name: `Xem thông tin ${bob.displayName}` }).click()
    await expect(a.getByRole('dialog', { name: 'Thông tin tài khoản' })).toContainText('0901 234 567')
    await expect(a.getByRole('dialog', { name: 'Thông tin tài khoản' })).toContainText('03 tháng 02, 2000')
    await a.keyboard.press('Escape')

    // ---- Ảnh đại diện tài khoản: Bob đổi ảnh, Alice thấy ngay ----
    await b.getByRole('button', { name: 'Thông tin tài khoản' }).click()
    await expect(b.getByRole('dialog', { name: 'Thông tin tài khoản' }).getByText('Thông tin cá nhân')).toBeVisible()
    await b.getByTestId('profile-avatar-input').setInputFiles({ name: 'bob.png', mimeType: 'image/png', buffer: png(8, 8) })
    await expect(b.locator('.chat-user-avatar .avatar-image')).toBeVisible()
    await expect(a.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${roomId}"] .avatar-image`)).toBeVisible()
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})

test('phê duyệt thành viên mới: thành viên thường thêm người thì chờ trưởng nhóm duyệt mới vào nhóm', async ({ browser }) => {
  const [alice, bob, carol] = await Promise.all([account(browser, 'alice'), account(browser, 'bob'), account(browser, 'carol')])
  try {
    const roomId = await channelWith(alice, bob) // Alice tạo kênh → trưởng nhóm
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)
    const carolHome = await open(carol, '/')
    const joined = async (acc: typeof carol) =>
      (await (await acc.context.request.get('/api/rooms', { headers: auth(acc) })).json()).rooms.find((r: { id: string }) => r.id === roomId)?.joined

    // Trưởng nhóm bật phê duyệt trong danh sách thành viên.
    await a.getByRole('button', { name: '2 thành viên' }).click()
    await a.getByRole('switch', { name: /Phê duyệt thành viên mới/ }).check()
    await expect(a.getByRole('switch', { name: /Phê duyệt thành viên mới/ })).toBeChecked()
    await a.keyboard.press('Escape')

    // Bob (thành viên thường) thêm Carol → chỉ gửi yêu cầu.
    await b.getByRole('toolbar', { name: 'Công cụ soạn tin' }).getByRole('button', { name: 'Thêm thành viên' }).click()
    const add = b.getByRole('dialog', { name: /Thêm thành viên vào/ })
    await expect(add.getByText(/Nhóm đang bật phê duyệt/)).toBeVisible()
    await add.getByRole('searchbox', { name: 'Tìm nhân viên' }).fill(carol.displayName)
    await add.getByRole('checkbox', { name: new RegExp(carol.displayName) }).check()
    await add.getByRole('button', { name: 'Gửi yêu cầu thêm 1 người' }).click()
    await expect(b.locator('.toast', { hasText: 'Đã gửi yêu cầu thêm thành viên' })).toBeVisible()
    expect(await joined(carol)).toBeFalsy()

    // Alice thấy "1 chờ duyệt" ngay (realtime), duyệt → Carol vào nhóm và thấy nhóm không cần tải lại.
    await a.getByRole('button', { name: '· 1 chờ duyệt' }).click()
    const requests = a.getByRole('region', { name: 'Yêu cầu chờ duyệt' })
    await expect(requests).toContainText(carol.displayName)
    await expect(requests).toContainText(`Do ${bob.displayName} thêm`)
    await requests.getByRole('button', { name: 'Duyệt' }).click()
    await expect(requests).toHaveCount(0)
    await expect.poll(() => joined(carol)).toBe(true)
    await expect(carolHome.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${roomId}"]`)).toBeVisible()
    await expect(a.getByRole('button', { name: /chờ duyệt/ })).toHaveCount(0)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close(), carol.context.close()])
  }
})

test('Ctrl+V dán ảnh vào ô nhập: khay "N ảnh", gửi mỗi ảnh một tin, người nhận thấy ảnh lớn như Zalo', async ({ browser }) => {
  const [alice, bob] = await Promise.all([account(browser, 'alice'), account(browser, 'bob')])
  try {
    const roomId = await channelWith(alice, bob)
    const a = await open(alice, `/rooms/${roomId}`)
    const b = await open(bob, `/rooms/${roomId}`)
    const images = [png(400, 300), png(300, 400)].map((buf) => buf.toString('base64'))
    await expect(box(a)).toBeEnabled() // ô nhập mở khi lịch sử đã tải
    // Mô phỏng Ctrl+V: sự kiện paste thật của trình duyệt mang 2 ảnh trong clipboard.
    await box(a).evaluate((el, data) => {
      const transfer = new DataTransfer()
      data.forEach((b64, i) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        transfer.items.add(new File([bytes], i === 0 ? 'image.png' : 'chup-man-hinh.png', { type: 'image/png' }))
      })
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
    }, images)
    const tray = a.getByRole('group', { name: 'Ảnh sẽ gửi' })
    await expect(tray.getByText('2 ảnh')).toBeVisible()
    await expect(tray.locator('.tray-item--done')).toHaveCount(2)
    await box(a).fill('Thẻ sinh viên nè')
    await a.getByRole('button', { name: 'Gửi', exact: true }).click()
    await expect(tray).toHaveCount(0)

    // Bob: 2 ảnh hiện lớn (không kèm dòng tên file), rồi tới lời nhắn.
    const imgs = b.locator('.message-list .attachment-image')
    await expect(imgs).toHaveCount(2)
    await expect(b.locator('.message-list .attachment--image .attachment-name')).toHaveCount(0)
    const first = await imgs.first().boundingBox()
    expect(first!.width).toBeGreaterThan(300)
    await expect(bubble(b, 'Thẻ sinh viên nè')).toBeVisible()
    const order = await b.locator('.message-list .message').evaluateAll((els) =>
      els.map((el) => (el.querySelector('.attachment-image') ? 'ảnh' : el.textContent?.includes('Thẻ sinh viên nè') ? 'chữ' : '')).filter(Boolean))
    expect(order).toEqual(['ảnh', 'ảnh', 'chữ'])
    // Tải ảnh về bằng nút ⤓ khi rê chuột.
    await imgs.first().hover()
    const download = b.waitForEvent('download')
    await b.locator('.message-list .attachment-download').first().click()
    expect((await download).suggestedFilename()).toMatch(/^anh-dan-\d+\.png$/)
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
