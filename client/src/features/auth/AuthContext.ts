import { createContext, useContext } from 'react'

export interface AuthContextValue {
  /** true khi phiên bị kết thúc do refresh thất bại (không phải tự logout). */
  sessionExpired: boolean
  dismissSessionExpired: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>')
  return ctx
}
