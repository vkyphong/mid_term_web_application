import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

test('F13: identical workload, all four real transports, JSON evidence, cancellation and mobile', async ({ page, request }) => {
  page.setDefaultTimeout(15_000)
  const email = `lab-ui-${randomUUID()}@dqgm.dev`
  const password = 'LabBrowser123'
  const registration = await request.post('/api/auth/register', { data: { email, displayName: 'Protocol Lab Test', password } })
  expect(registration.status()).toBe(201)
  const account = await registration.json()
  const errors: string[] = []
  const wsFrames: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/lab/ws') socket.on('framesent', ({ payload }) => {
      // Never retain the auth frame or its Bearer token.
      const text = payload.toString()
      if (!text.includes('lab:auth')) wsFrames.push(text)
    })
  })
  await page.goto('/lab')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await expect(page).toHaveURL(/\/lab$/)
  await expect(page.getByRole('heading', { name: 'Protocol Lab', exact: true })).toBeVisible()
  // The default workload is identical to the documented browser preset, not a reduced demo.
  await expect(page.getByLabel(/^Số tin/)).toHaveValue('20')
  await expect(page.getByLabel(/^Khoảng gửi \(ms\)/)).toHaveValue('250')
  await expect(page.getByLabel(/^Payload text \(byte\)/)).toHaveValue('128')
  await page.getByRole('button', { name: '▶ Chạy cả 4 giao thức', exact: true }).click()
  await expect(page.getByText('4/4 bài đo hoàn tất', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.lab-table tbody tr')).toHaveCount(4)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Tải JSON' }).click()])
  const report = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(report.results.map((r: { protocol: string }) => r.protocol)).toEqual(['poll', 'long-poll', 'sse', 'websocket'])
  const common = { count: 20, intervalMs: 250, payloadBytes: 128, pollMs: 100 }
  for (const result of report.results) {
    expect(result.status).toBe('complete')
    expect(result.config).toEqual(common)
    expect(result.samples).toHaveLength(20)
    expect(result.samples.map((s: { index: number }) => s.index)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(result.p95Ms).toBeGreaterThanOrEqual(result.p50Ms)
    expect(result.workloadElapsedMs).toBeGreaterThanOrEqual(4900)
    expect(result.workloadElapsedMs).toBeLessThan(5500)
    expect(result.samples.every((s: { scheduleLagMs: number }) => s.scheduleLagMs < 250)).toBe(true)
    if (result.protocol !== 'websocket') {
      expect(result.metrics.httpRequests).toBeGreaterThanOrEqual(22)
      expect(result.metrics.httpRequests).toBe(result.metrics.httpResponses)
      expect(result.metrics.requestHeaderBytesEstimate).toBeGreaterThan(0)
    } else {
      expect(result.metrics.httpRequests).toBe(0)
      expect(result.metrics.wsHandshakeCount).toBe(1)
      expect(result.metrics.wsFrameOverheadBytesEstimate).toBe(240)
    }
  }
  expect(wsFrames).toHaveLength(20)
  for (const frame of wsFrames) {
    expect(frame).not.toContain('STOMP')
    const ping = JSON.parse(frame)
    expect(ping.type).toBe('lab:ping')
    expect(ping.payload.id).toBe(ping.correlationId)
    expect(ping.payload.text).toBe('x'.repeat(128))
  }
  expect(JSON.stringify(report)).not.toContain(account.accessToken)
  // Each new login/session has a distinct Lab history even for the same account.
  const secondLogin = await request.post('/api/auth/login', { data: { email, password } })
  expect(secondLogin.ok()).toBe(true)
  const second = await secondLogin.json()
  const isolated = await request.get('/api/lab/poll', { headers: { Authorization: `Bearer ${second.accessToken}` } })
  expect((await isolated.json()).events).toEqual([])
  const evidenceDir = process.env.LAB_EVIDENCE_DIR
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true })
    await download.saveAs(join(evidenceDir, 'browser-results.json'))
    await page.screenshot({ path: join(evidenceDir, 'desktop.png'), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Tải JSON' })).toBeVisible()
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, 'mobile.png'), fullPage: true })
  await page.getByRole('combobox').selectOption('long-poll')
  await page.getByRole('button', { name: '▶ Chạy Long Polling', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dừng bài đo', exact: true })).toBeVisible()
  await expect(page.locator('.lab-run-status')).toContainText('Long Polling')
  await page.getByRole('button', { name: 'Dừng bài đo', exact: true }).click()
  await expect(page.getByRole('button', { name: '▶ Chạy Long Polling', exact: true })).toBeVisible()
  await expect(page.getByText('Đã dừng', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Protocol Lab', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
