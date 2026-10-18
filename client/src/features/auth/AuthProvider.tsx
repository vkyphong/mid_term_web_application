import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshAccessToken, setRefreshHandler } from '../../lib/apiClient'
import { authApi } from './authApi'
import { AuthContext } from './AuthContext'
import { useSession } from './hooks'
import { msUntilProactiveRefresh, setSession, toSession } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { session } = useSession()
  const [sessionExpired, setSessionExpired] = useState(false)

  // Hàm refresh dùng chung cho apiClient (khi gặp 401) và refresh chủ động.
  useEffect(() => {
    setRefreshHandler(async () => {
      try {
        const next = toSession(await authApi.refresh())
        setSession(queryClient, next)
        return next.accessToken
      } catch {
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
    const timer = setTimeout(() => void refreshAccessToken(), msUntilProactiveRefresh(session))
    return () => clearTimeout(timer)
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
