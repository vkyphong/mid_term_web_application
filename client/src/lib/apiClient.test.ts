import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authRequest, request, setRefreshHandler } from './apiClient'
import { ApiError } from './apiError'
import { tokenStore } from './tokenStore'

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set('old-token')
})

afterEach(() => {
  fetchMock.mockReset()
  setRefreshHandler(null)
  vi.unstubAllGlobals()
})

describe('request', () => {
  it('chuẩn hoá lỗi theo contract', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, { error: { code: 'forbidden', reason: 'domain_not_allowed' } }),
    )
    const err = await request('/api/auth/register').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 403, code: 'forbidden', reason: 'domain_not_allowed' })
  })

  it('suy ra code từ status khi body không đúng contract', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Too many', { status: 429 }))
    await expect(request('/x')).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('trả network_error khi fetch thất bại', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(request('/x')).rejects.toMatchObject({ code: 'network_error' })
  })

  it('luôn gửi cookie (credentials: include)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204))
    await request('/api/auth/logout', { method: 'POST' })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })
})

describe('authRequest', () => {
  it('refresh một lần khi 401 rồi thử lại với token mới', async () => {
    const refresh = vi.fn().mockResolvedValue('new-token')
    setRefreshHandler(refresh)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthorized' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))

    await expect(authRequest('/api/rooms')).resolves.toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    const headers = (call: number) => new Headers(fetchMock.mock.calls[call][1]?.headers)
    expect(headers(0).get('Authorization')).toBe('Bearer old-token')
    expect(headers(1).get('Authorization')).toBe('Bearer new-token')
  })

  it('không lặp refresh nếu vẫn 401 sau khi refresh', async () => {
    const refresh = vi.fn().mockResolvedValue('new-token')
    setRefreshHandler(refresh)
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'unauthorized' } }))

    await expect(authRequest('/api/rooms')).rejects.toMatchObject({ status: 401 })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gộp các refresh đồng thời thành một', async () => {
    const refresh = vi.fn().mockResolvedValue('new-token')
    setRefreshHandler(refresh)
    fetchMock.mockImplementation(async (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization')
      return auth === 'Bearer new-token'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, { error: { code: 'unauthorized' } })
    })

    await Promise.all([authRequest('/a'), authRequest('/b'), authRequest('/c')])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('ném lỗi gốc khi refresh thất bại', async () => {
    setRefreshHandler(vi.fn().mockResolvedValue(null))
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'unauthorized' } }))
    await expect(authRequest('/a')).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
