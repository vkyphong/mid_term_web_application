export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  email: string
  displayName: string
  role: UserRole
}

/** Response chung của register / login / refresh. */
export interface AuthResponse {
  accessToken: string
  /** Số giây đến khi access token hết hạn (BE: 900). */
  expiresIn: number
  user: User
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  email: string
  displayName: string
  password: string
}

export interface Session {
  user: User
  accessToken: string
  /** Epoch ms. */
  expiresAt: number
}
