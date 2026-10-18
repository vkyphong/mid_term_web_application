import { config } from '../../config'
import { request } from '../../lib/apiClient'
import { mockAuthApi } from './mockAuthApi'
import type { AuthResponse, LoginInput, RegisterInput } from './types'

export interface AuthApi {
  register(input: RegisterInput): Promise<AuthResponse>
  login(input: LoginInput): Promise<AuthResponse>
  /** Dùng refresh token trong cookie httpOnly để lấy access token mới. */
  refresh(): Promise<AuthResponse>
  logout(): Promise<void>
}

export const httpAuthApi: AuthApi = {
  register: (input) => request('/api/auth/register', { method: 'POST', body: input }),
  login: (input) => request('/api/auth/login', { method: 'POST', body: input }),
  refresh: () => request('/api/auth/refresh', { method: 'POST' }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
}

export const authApi: AuthApi = config.useMockApi ? mockAuthApi : httpAuthApi
