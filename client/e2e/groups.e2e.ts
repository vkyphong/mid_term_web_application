import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { crc32 } from 'node:zlib'

/** Nhóm: tạo kèm thành viên, thêm người, @All, thanh công cụ soạn tin, file Office/TXT/CSV/ZIP, nhóm lưu trữ — backend thật. */

interface Account { context: BrowserContext; id: string; token: string; displayName: string }

async function account(browser: Browser, label: string): Promise<Account> {
  const context = await browser.newContext({ baseURL: 'http://localhost:8080' })
  const displayName = `E2E ${label} ${crypto.randomUUID().slice(0, 6)}`
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
    const b = await open(bob, `/rooms/${otherRoom}`)
    await b.locator('.composer textarea').click() // tương tác đầu tiên để trình duyệt cho phát âm thanh
    const a = await open(alice, `/rooms/${roomId}`)
    const link = b.getByRole('navigation', { name: 'Danh sách phòng' }).locator(`a[href="/rooms/${roomId}"]`)

    await box(a).fill('Tin 1')
    await a.keyboard.press('Enter')
    await expect(link.locator('.unread-badge')).toHaveText('1')
    await expect(b).toHaveTitle('(1) Tập Đoàn M Chat')
    await expect.poll(() => b.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBeGreaterThan(0)

    for (const i of [2, 3, 4, 5, 6]) {
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
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
