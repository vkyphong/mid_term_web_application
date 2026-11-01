import { authRequest } from '../../lib/apiClient'

export interface AdminStats {
  connections: number
  onlineUsers: number
  msgPerSec: number
  activeRooms: number
}

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
  enabled: boolean
  online: boolean
}

export interface UserPage {
  users: AdminUser[]
  total: number
  page: number
  pageSize: number
}

export interface ChannelActivity {
  id: string
  name: string
  members: number
  messagesLastMinute: number
  lastMessageAt: string
}

export const adminApi = {
  stats: () => authRequest<AdminStats>('/api/admin/stats'),
  users: (search: string, page: number) => authRequest<UserPage>(`/api/admin/users?${new URLSearchParams({ search, page: String(page) })}`),
  channels: () => authRequest<{ channels: ChannelActivity[] }>('/api/admin/channels'),
  moderate: (id: string, action: 'kick' | 'ban') => authRequest<void>(`/api/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  broadcast: (content: string) => authRequest<{ recipients: number }>('/api/admin/broadcast', { method: 'POST', body: { content } }),
}
