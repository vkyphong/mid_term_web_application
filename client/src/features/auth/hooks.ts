import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi } from './authApi'
import { restoreSession, sessionQueryKey, setSession, toSession } from './session'
import type { LoginInput, RegisterInput, Session } from './types'

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export function useSession() {
  const query = useQuery<Session | null>({
    queryKey: sessionQueryKey,
    queryFn: restoreSession,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const session = query.data ?? null
  const status: SessionStatus = query.isPending
    ? 'loading'
    : session
      ? 'authenticated'
      : 'unauthenticated'

  return { status, session, user: session?.user ?? null }
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: (res) => setSession(queryClient, toSession(res)),
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: (res) => setSession(queryClient, toSession(res)),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => authApi.logout(),
    // Kể cả khi request lỗi, phía client vẫn phải xoá phiên.
    onSettled: () => {
      setSession(queryClient, null)
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
  })
}
