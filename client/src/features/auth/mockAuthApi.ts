/**
 * Mock API chạy trong trình duyệt khi BE chưa sẵn sàng (VITE_USE_MOCK_API=true).
 * Mô phỏng contract ở docs/api/auth.md. CHỈ dùng cho dev/demo.
 *
 * "Cookie" refresh và user hiện tại nằm trong sessionStorage nên mỗi tab có thể đăng nhập
 * một tài khoản khác (để demo chat nhiều người); F5 trong cùng tab vẫn giữ phiên.
 */
import { config } from '../../config'
import { ApiError } from '../../lib/apiError'
import type { AuthApi } from './authApi'
import { isAllowedEmailDomain, normalizeEmail } from './domain'
import type { AuthResponse, User } from './types'

const USERS_KEY = 'pulsechat.mock.users'
const REFRESH_KEY = 'pulsechat.mock.refresh' // giả lập cookie httpOnly (theo tab)
const CURRENT_USER_KEY = 'pulsechat.mock.currentUser'
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

function readTab<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Tài khoản demo có sẵn (mật khẩu Demo1234) để thử nhắn tin riêng. */
export const MOCK_DEMO_PASSWORD = 'Demo1234'
const DEMO_USERS = [
  { local: 'phong', displayName: 'Phong (demo)' },
  { local: 'an', displayName: 'An (demo)' },
]

async function ensureDemoUsers() {
  const users = read<StoredUser[]>(USERS_KEY, [])
  const domain = config.allowedEmailDomains[0] ?? 'dqgm.dev'
  const missing = DEMO_USERS.filter((d) => !users.some((u) => u.email === `${d.local}@${domain}`))
  if (!missing.length) return
  const passwordHash = await hash(MOCK_DEMO_PASSWORD)
  write(USERS_KEY, [
    ...read<StoredUser[]>(USERS_KEY, []),
    ...missing.map((d) => ({
      id: crypto.randomUUID(), email: `${d.local}@${domain}`, displayName: d.displayName, role: 'user' as const, passwordHash,
    })),
  ])
}

/** User đăng nhập trong tab này (mock chat dùng để biết ai gửi). */
export function getMockCurrentUser(): User | null {
  return readTab<User>(CURRENT_USER_KEY)
}

export function listMockUsers(): Pick<User, 'id' | 'email' | 'displayName'>[] {
  return read<StoredUser[]>(USERS_KEY, []).map(({ id, email, displayName }) => ({ id, email, displayName }))
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
  const publicUser: User = { id: user.id, email: user.email, displayName: user.displayName, role: user.role }
  sessionStorage.setItem(REFRESH_KEY, JSON.stringify(refresh))
  sessionStorage.setItem(CURRENT_USER_KEY, JSON.stringify(publicUser))
  return {
    accessToken: `mock.${crypto.randomUUID()}`,
    expiresIn: config.mockAccessTtlSeconds,
    user: publicUser,
  }
}

const unauthorized = (reason: 'invalid_credentials' | 'refresh_invalid', message: string) =>
  new ApiError(401, { code: 'unauthorized', reason, message })

export const mockAuthApi: AuthApi = {
  async register(input) {
    await delay()
    await ensureDemoUsers()
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
    await ensureDemoUsers()
    const email = normalizeEmail(input.email)
    const user = read<StoredUser[]>(USERS_KEY, []).find((u) => u.email === email)
    if (!user || user.passwordHash !== (await hash(input.password))) {
      throw unauthorized('invalid_credentials', 'Invalid email or password')
    }
    return issueSession(user)
  },

  async refresh() {
    await delay(150)
    await ensureDemoUsers()
    const stored = readTab<StoredRefresh>(REFRESH_KEY)
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
    const stored = readTab<StoredRefresh>(REFRESH_KEY)
    if (stored) write(REVOKED_KEY, [...read<string[]>(REVOKED_KEY, []), stored.token])
    sessionStorage.removeItem(REFRESH_KEY)
    sessionStorage.removeItem(CURRENT_USER_KEY)
  },
}
