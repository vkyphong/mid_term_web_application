import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/apiError'
import { tokenStore } from '../../lib/tokenStore'
import { authApi } from './authApi'
import type { AuthResponse, Session } from './types'

export const sessionQueryKey = ['auth', 'session'] as const
let revision = 0
export const sessionRevision = () => revision

export function toSession(res: AuthResponse): Session {
  return {
    user: res.user,
    accessToken: res.accessToken,
    expiresAt: Date.now() + res.expiresIn * 1000,
  }
}

/** Ghi phiên vào cache TanStack Query và đồng bộ token cho apiClient. */
export function setSession(queryClient: QueryClient, session: Session | null) {
  revision++
  tokenStore.set(session?.accessToken ?? null)
  queryClient.setQueryData<Session | null>(sessionQueryKey, session)
}

/**
 * Khôi phục phiên khi tải trang bằng refresh-token cookie.
 * 401/403 nghĩa là chưa đăng nhập (không phải lỗi).
 */
export async function restoreSession(): Promise<Session | null> {
  try {
    const session = toSession(await authApi.refresh())
    tokenStore.set(session.accessToken)
    return session
  } catch (err) {
    tokenStore.set(null)
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
    if (err instanceof ApiError && err.code === 'network_error') return null
    throw err
  }
}

/** Refresh sớm trước khi hết hạn: tối đa 60s, hoặc 20% TTL nếu TTL ngắn. */
export function msUntilProactiveRefresh(session: Session, now = Date.now()): number {
  const remaining = session.expiresAt - now
  const lead = Math.min(60_000, remaining * 0.2)
  return Math.max(0, remaining - lead)
}
