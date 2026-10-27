import { config } from '../../config'
import { authBlob, authRequest, authUpload } from '../../lib/apiClient'
import { createMockChat } from './mockChat'
import { createStompTransport, type ChatTransport } from './transport'
import type { CreateRoomInput, MessagePage, NotificationPage, Presence, Room, Upload, UserSummary } from './types'

export const HISTORY_PAGE_SIZE = 30

export interface ChatApi {
  listRooms(): Promise<Room[]>
  createRoom(input: CreateRoomInput): Promise<Room>
  searchUsers(search: string): Promise<UserSummary[]>
  openDm(userId: string): Promise<Room>
  /** Trang tin mới nhất, hoặc trang cũ hơn `before` (cursor từ trang trước). */
  listMessages(roomId: string, before?: string): Promise<MessagePage>
  /** F06: snapshot online/lastSeen của mọi user. */
  getPresence(): Promise<Presence[]>
  /** F09: thành viên hiện tại của phòng (để chọn @mention). */
  listMembers(roomId: string): Promise<UserSummary[]>
  /** F09: thông báo mới nhất trước, kèm số chưa đọc. */
  listNotifications(before?: string): Promise<NotificationPage>
  markNotificationRead(id: string): Promise<void>
  /** F15: upload một file (JPEG/PNG/PDF ≤ 5 MiB) vào phòng. */
  uploadFile(roomId: string, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<Upload>
  /** F15: tải file đính kèm (cần đăng nhập và là thành viên phòng). */
  downloadFile(url: string): Promise<Blob>
}

export const httpChatApi: ChatApi = {
  listRooms: async () => (await authRequest<{ rooms: Room[] }>('/api/rooms')).rooms,
  createRoom: (input) => authRequest('/api/rooms', { method: 'POST', body: input }),
  searchUsers: async (search) => {
    const params = new URLSearchParams({ search, limit: '20' })
    return (await authRequest<{ users: UserSummary[] }>(`/api/users?${params}`)).users
  },
  openDm: (userId) => authRequest('/api/dms', { method: 'POST', body: { userId } }),
  listMessages: (roomId, before) => {
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) })
    if (before) params.set('before', before)
    return authRequest(`/api/rooms/${encodeURIComponent(roomId)}/messages?${params}`)
  },
  getPresence: async () => (await authRequest<{ users: Presence[] }>('/api/presence')).users,
  listMembers: async (roomId) =>
    (await authRequest<{ members: UserSummary[] }>(`/api/rooms/${encodeURIComponent(roomId)}/members`)).members,
  listNotifications: (before) => {
    const params = new URLSearchParams({ limit: '30' })
    if (before) params.set('before', before)
    return authRequest(`/api/notifications?${params}`)
  },
  markNotificationRead: (id) => authRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  uploadFile: (roomId, file, onProgress, signal) => {
    const form = new FormData()
    form.append('roomId', roomId)
    form.append('file', file)
    return authUpload('/api/uploads', form, onProgress, signal)
  },
  downloadFile: (url) => authBlob(url),
}

const mock = config.useMockApi ? createMockChat() : null

export const chatApi: ChatApi = mock ? mock.api : httpChatApi
export const chatTransport: ChatTransport = mock ? mock.transport : createStompTransport()
