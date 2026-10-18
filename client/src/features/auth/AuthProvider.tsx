import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshAccessToken, setRefreshHandler } from '../../lib/apiClient'
import { ApiError } from '../../lib/apiError'
import { authApi } from './authApi'
import { AuthContext } from './AuthContext'
import { useSession } from './hooks'
import { msUntilProactiveRefresh, sessionRevision, setSession, toSession } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { session } = useSession()
  const [sessionExpired, setSessionExpired] = useState(false)

  // Hàm refresh dùng chung cho apiClient (khi gặp 401) và refresh chủ động.
  useEffect(() => {
    setRefreshHandler(async () => {
      const revision = sessionRevision()
      try {
        const next = toSession(await authApi.refresh())
        if (revision !== sessionRevision()) return null
        setSession(queryClient, next)
        return next.accessToken
      } catch (error) {
        if (revision !== sessionRevision()) return null
        if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) throw error
        setSession(queryClient, null)
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
        setSessionExpired(true)
        return null
      }
    })
    return () => setRefreshHandler(null)
  }, [queryClient])

  // Refresh chủ động trước khi access token hết hạn.
  useEffect(() => {
    if (!session) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { await refreshAccessToken() }
      catch { if (!stopped) timer = setTimeout(() => void refresh(), 5000) }
    }
    timer = setTimeout(() => void refresh(), msUntilProactiveRefresh(session))
    return () => { stopped = true; clearTimeout(timer) }
  }, [session])

  useEffect(() => {
    if (session) setSessionExpired(false)
  }, [session])

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), [])
  const value = useMemo(
    () => ({ sessionExpired, dismissSessionExpired }),
    [sessionExpired, dismissSessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
