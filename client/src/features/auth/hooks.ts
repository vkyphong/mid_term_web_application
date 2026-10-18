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
    onMutate: () => queryClient.cancelQueries({ queryKey: sessionQueryKey }),
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: (res) => setSession(queryClient, toSession(res)),
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey: sessionQueryKey }),
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: (res) => setSession(queryClient, toSession(res)),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => authApi.logout(),
    // Clear locally before the request so an in-flight refresh cannot restore a logged-out session.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: sessionQueryKey })
      setSession(queryClient, null)
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
  })
}
