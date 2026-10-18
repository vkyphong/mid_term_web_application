/**
 * Mock API chạy trong trình duyệt khi BE chưa sẵn sàng (VITE_USE_MOCK_API=true).
 * Mô phỏng contract ở docs/api/auth.md. CHỈ dùng cho dev/demo.
 */
import { config } from '../../config'
import { ApiError } from '../../lib/apiError'
import type { AuthApi } from './authApi'
import { isAllowedEmailDomain, normalizeEmail } from './domain'
import type { AuthResponse, User } from './types'

const USERS_KEY = 'pulsechat.mock.users'
const REFRESH_KEY = 'pulsechat.mock.refresh' // giả lập cookie httpOnly
const REVOKED_KEY = 'pulsechat.mock.revoked'
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface StoredUser extends User {
  passwordHash: string
}

interface StoredRefresh {
  token: string
  userId: string
  expiresAt: number
}

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms))

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

async function hash(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function issueSession(user: StoredUser): AuthResponse {
  const refresh: StoredRefresh = {
    token: crypto.randomUUID(),
    userId: user.id,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  }
  write(REFRESH_KEY, refresh)
  return {
    accessToken: `mock.${crypto.randomUUID()}`,
    expiresIn: config.mockAccessTtlSeconds,
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
  }
}

const unauthorized = (reason: 'invalid_credentials' | 'refresh_invalid', message: string) =>
  new ApiError(401, { code: 'unauthorized', reason, message })

export const mockAuthApi: AuthApi = {
  async register(input) {
    await delay()
    const email = normalizeEmail(input.email)
    if (!isAllowedEmailDomain(email, config.allowedEmailDomains)) {
      throw new ApiError(403, {
        code: 'forbidden',
        reason: 'domain_not_allowed',
        message: 'Email domain is not allowed',
      })
    }
    const users = read<StoredUser[]>(USERS_KEY, [])
    if (users.some((u) => u.email === email)) {
      throw new ApiError(409, {
        code: 'invalid_payload',
        reason: 'email_taken',
        message: 'Email already registered',
      })
    }
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email,
      displayName: input.displayName.trim(),
      role: 'user',
      passwordHash: await hash(input.password),
    }
    write(USERS_KEY, [...users, user])
    return issueSession(user)
  },

  async login(input) {
    await delay()
    const email = normalizeEmail(input.email)
    const user = read<StoredUser[]>(USERS_KEY, []).find((u) => u.email === email)
    if (!user || user.passwordHash !== (await hash(input.password))) {
      throw unauthorized('invalid_credentials', 'Invalid email or password')
    }
    return issueSession(user)
  },

  async refresh() {
    await delay(150)
    const stored = read<StoredRefresh | null>(REFRESH_KEY, null)
    const revoked = read<string[]>(REVOKED_KEY, [])
    if (!stored || stored.expiresAt < Date.now() || revoked.includes(stored.token)) {
      throw unauthorized('refresh_invalid', 'Refresh token invalid or expired')
    }
    const user = read<StoredUser[]>(USERS_KEY, []).find((u) => u.id === stored.userId)
    if (!user) throw unauthorized('refresh_invalid', 'User not found')
    // Rotation: token cũ bị thu hồi khi cấp token mới.
    write(REVOKED_KEY, [...revoked, stored.token])
    return issueSession(user)
  },

  async logout() {
    await delay(150)
    const stored = read<StoredRefresh | null>(REFRESH_KEY, null)
    if (stored) write(REVOKED_KEY, [...read<string[]>(REVOKED_KEY, []), stored.token])
    localStorage.removeItem(REFRESH_KEY)
  },
}
