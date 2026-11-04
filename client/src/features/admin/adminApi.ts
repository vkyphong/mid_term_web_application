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

export interface AdminGroup {
  id: string
  name: string
  description: string | null
  archived: boolean
  memberCount: number
  lastMessageAt: string | null
}

export interface GroupPage {
  groups: AdminGroup[]
  total: number
  page: number
  pageSize: number
}

export interface GroupMember {
  id: string
  displayName: string
  email: string
  enabled: boolean
  memberRole?: string | null
}

export interface GroupInput {
  name: string
  description: string | null
}

const group = (id: string) => `/api/admin/groups/${encodeURIComponent(id)}`

export const adminApi = {
  stats: () => authRequest<AdminStats>('/api/admin/stats'),
  users: (search: string, page: number) => authRequest<UserPage>(`/api/admin/users?${new URLSearchParams({ search, page: String(page) })}`),
  channels: () => authRequest<{ channels: ChannelActivity[] }>('/api/admin/channels'),
  moderate: (id: string, action: 'kick' | 'ban') => authRequest<void>(`/api/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  broadcast: (content: string) => authRequest<{ recipients: number }>('/api/admin/broadcast', { method: 'POST', body: { content } }),
  groups: (search: string, archived: boolean | undefined, page: number) => {
    const params = new URLSearchParams({ search, page: String(page) })
    if (archived !== undefined) params.set('archived', String(archived))
    return authRequest<GroupPage>(`/api/admin/groups?${params}`)
  },
  createGroup: (input: GroupInput) => authRequest<AdminGroup>('/api/admin/groups', { method: 'POST', body: input }),
  updateGroup: (id: string, input: GroupInput) => authRequest<AdminGroup>(group(id), { method: 'PATCH', body: input }),
  archiveGroup: (id: string, archived: boolean) => authRequest<AdminGroup>(`${group(id)}/archive`, { method: 'POST', body: { archived } }),
  groupMembers: async (id: string) => (await authRequest<{ members: GroupMember[] }>(`${group(id)}/members`)).members,
  addGroupMember: (id: string, userId: string) => authRequest<AdminGroup>(`${group(id)}/members`, { method: 'POST', body: { userId } }),
  removeGroupMember: (id: string, userId: string) =>
    authRequest<AdminGroup>(`${group(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}
