import { config } from '../../config'
import { request } from '../../lib/apiClient'
import { mockAuthApi } from './mockAuthApi'
import type { AuthResponse, LoginInput, RegisterInput } from './types'
import { z } from 'zod'

const responseSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().finite().positive(),
  user: z.object({ id: z.string(), email: z.string().email(), displayName: z.string(), role: z.enum(['user', 'admin']) }),
})

async function authPost(path: string, body?: unknown): Promise<AuthResponse> {
  return responseSchema.parse(await request(path, { method: 'POST', body }))
}

export interface AuthApi {
  register(input: RegisterInput): Promise<AuthResponse>
  login(input: LoginInput): Promise<AuthResponse>
  /** Dùng refresh token trong cookie httpOnly để lấy access token mới. */
  refresh(): Promise<AuthResponse>
  logout(): Promise<void>
}

export const httpAuthApi: AuthApi = {
  register: (input) => authPost('/api/auth/register', input),
  login: (input) => authPost('/api/auth/login', input),
  refresh: () => {
    const refresh = () => authPost('/api/auth/refresh')
    // Serialize cookie rotation across tabs where Web Locks is available.
    return navigator.locks ? navigator.locks.request('pulsechat-refresh', refresh) : refresh()
  },
  logout: () => request('/api/auth/logout', { method: 'POST' }),
}

export const authApi: AuthApi = config.useMockApi ? mockAuthApi : httpAuthApi
