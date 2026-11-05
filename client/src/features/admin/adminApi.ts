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
  /** Thành viên thường thêm người phải chờ trưởng / phó nhóm duyệt. */
  requireApproval: boolean
  pendingRequests: number
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
  memberRole?: GroupRole | null
}

export type GroupRole = 'owner' | 'deputy' | 'member'

export interface GroupInput {
  name: string
  description: string | null
}

export interface AuditEntry {
  id: string
  at: string
  actor: { id: string; displayName: string; email: string }
  action: string
  targetType: 'user' | 'group' | 'system'
  targetId: string | null
  targetLabel: string | null
  detail: string | null
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
}

const group = (id: string) => `/api/admin/groups/${encodeURIComponent(id)}`

export const adminApi = {
  stats: () => authRequest<AdminStats>('/api/admin/stats'),
  users: (search: string, page: number) => authRequest<UserPage>(`/api/admin/users?${new URLSearchParams({ search, page: String(page) })}`),
  channels: () => authRequest<{ channels: ChannelActivity[] }>('/api/admin/channels'),
  moderate: (id: string, action: 'kick' | 'ban') => authRequest<void>(`/api/admin/users/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
  unban: (id: string) => authRequest<void>(`/api/admin/users/${encodeURIComponent(id)}/unban`, { method: 'POST' }),
  setRole: (id: string, role: 'admin' | 'user') =>
    authRequest<void>(`/api/admin/users/${encodeURIComponent(id)}/role`, { method: 'PUT', body: { role } }),
  audit: (page: number) => authRequest<AuditPage>(`/api/admin/audit?page=${page}`),
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
  setGroupMemberRole: async (id: string, userId: string, role: GroupRole) =>
    (await authRequest<{ members: GroupMember[] }>(`${group(id)}/members/${encodeURIComponent(userId)}/role`, { method: 'PUT', body: { role } })).members,
  setGroupApproval: (id: string, requireApproval: boolean) =>
    authRequest<AdminGroup>(`${group(id)}/settings`, { method: 'PATCH', body: { requireApproval } }),
  removeGroupMember: (id: string, userId: string) =>
    authRequest<AdminGroup>(`${group(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}
