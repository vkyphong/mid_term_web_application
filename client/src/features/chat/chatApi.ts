import { config } from '../../config'
import { authBlob, authRequest, authUpload } from '../../lib/apiClient'
import { createMockChat } from './mockChat'
import { createStompTransport, type ChatTransport } from './transport'
import type { CreateRoomInput, MessagePage, NotificationPage, Presence, Room, RoomMember, Upload, UserSummary } from './types'

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
  /** F09: thành viên hiện tại của phòng (để chọn @mention), gồm cả tài khoản bị khoá. */
  listMembers(roomId: string): Promise<RoomMember[]>
  /** Thêm một nhân viên đang hoạt động vào kênh; thêm lại người đã có vẫn thành công. */
  addMember(roomId: string, userId: string): Promise<Room>
  /** Đổi tên kênh (mọi thành viên, kênh chưa lưu trữ). */
  renameRoom(roomId: string, name: string): Promise<Room>
  /** Biệt danh cho người kia trong DM; chuỗi rỗng = bỏ. Chỉ mình thấy. */
  setNickname(roomId: string, nickname: string): Promise<Room>
  /** Ảnh nhóm JPEG/PNG ≤ 2 MiB. */
  uploadRoomAvatar(roomId: string, file: File): Promise<Room>
  removeRoomAvatar(roomId: string): Promise<Room>
  /** F09: thông báo mới nhất trước, kèm số chưa đọc. */
  listNotifications(before?: string): Promise<NotificationPage>
  markNotificationRead(id: string): Promise<void>
  /** F15: upload một file (ảnh, PDF, văn bản, Office, ZIP ≤ 100 MB) vào phòng. */
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
    (await authRequest<{ members: RoomMember[] }>(`/api/rooms/${encodeURIComponent(roomId)}/members`)).members,
  addMember: (roomId, userId) =>
    authRequest(`/api/rooms/${encodeURIComponent(roomId)}/members`, { method: 'POST', body: { userId } }),
  renameRoom: (roomId, name) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', body: { name } }),
  setNickname: (roomId, nickname) =>
    authRequest(`/api/rooms/${encodeURIComponent(roomId)}/nickname`, { method: 'PUT', body: { nickname } }),
  uploadRoomAvatar: (roomId, file) => {
    const form = new FormData()
    form.append('file', file)
    return authUpload(`/api/rooms/${encodeURIComponent(roomId)}/avatar`, form)
  },
  removeRoomAvatar: (roomId) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}/avatar`, { method: 'DELETE' }),
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
