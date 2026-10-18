import { config } from '../config'
import { ApiError, toApiError } from './apiError'
import { tokenStore } from './tokenStore'

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
}

/** Request thô: JSON in/out, gửi kèm cookie, chuẩn hoá lỗi thành ApiError. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options
  const requestHeaders = new Headers(headers)
  if (body !== undefined && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      ...rest,
      credentials: 'include',
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, { code: 'network_error', message: 'Network error' })
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

type RefreshHandler = () => Promise<string | null>

let refreshHandler: RefreshHandler | null = null
let inflightRefresh: Promise<string | null> | null = null

/** AuthProvider đăng ký hàm refresh phiên; trả về access token mới hoặc null. */
export function setRefreshHandler(handler: RefreshHandler | null) {
  refreshHandler = handler
}

/** Gộp các lần refresh đồng thời thành một request duy nhất. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null)
  inflightRefresh ??= refreshHandler().finally(() => {
    inflightRefresh = null
  })
  return inflightRefresh
}

/**
 * Request cần đăng nhập: gắn Bearer token; nếu 401 thì refresh đúng một lần
 * rồi thử lại, không lặp vô hạn.
 */
export async function authRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const withToken = (token: string | null): RequestOptions => {
    const headers = new Headers(options.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return { ...options, headers }
  }

  try {
    return await request<T>(path, withToken(tokenStore.get()))
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    const newToken = await refreshAccessToken()
    if (!newToken) throw err
    return request<T>(path, withToken(newToken))
  }
}
