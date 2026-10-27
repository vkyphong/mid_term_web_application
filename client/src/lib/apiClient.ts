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
  // Một số endpoint trả 200 với body rỗng (vd đánh dấu thông báo đã đọc).
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
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

/** Chạy một request với Bearer token; 401 thì refresh đúng một lần rồi thử lại. */
async function withAuthRetry<T>(run: (token: string | null) => Promise<T>): Promise<T> {
  try {
    return await run(tokenStore.get())
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    const newToken = await refreshAccessToken()
    if (!newToken) throw err
    return run(newToken)
  }
}

/** Tải dữ liệu nhị phân cần đăng nhập (vd file đính kèm F15): <img src> không gửi được Bearer header. */
export function authBlob(path: string): Promise<Blob> {
  return withAuthRetry(async (token) => {
    let res: Response
    try {
      res = await fetch(`${config.apiBaseUrl}${path}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch {
      throw new ApiError(0, { code: 'network_error', message: 'Network error' })
    }
    if (!res.ok) throw await toApiError(res)
    return res.blob()
  })
}

/**
 * Upload multipart có tiến trình (fetch không báo tiến trình upload nên dùng XMLHttpRequest).
 * `onProgress` nhận tỉ lệ 0–1.
 */
export function authUpload<T>(path: string, form: FormData, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<T> {
  return withAuthRetry(
    (token) =>
      new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${config.apiBaseUrl}${path}`)
        xhr.withCredentials = true
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total)
        }
        xhr.onload = () => {
          let body: unknown
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
          } catch {
            body = undefined
          }
          if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T)
          const error = (body as { error?: ConstructorParameters<typeof ApiError>[1] } | undefined)?.error
          reject(new ApiError(xhr.status, error ?? { code: xhr.status === 413 ? 'invalid_payload' : 'unknown', message: xhr.statusText }))
        }
        xhr.onerror = () => reject(new ApiError(0, { code: 'network_error', message: 'Network error' }))
        xhr.onabort = () => reject(new ApiError(0, { code: 'network_error', message: 'Upload cancelled' }))
        signal?.addEventListener('abort', () => xhr.abort())
        xhr.send(form)
      }),
  )
}
