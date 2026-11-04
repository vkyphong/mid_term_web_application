import { config } from '../../config'
import { authBlob, authRequest, authUpload } from '../../lib/apiClient'
import { createMockChat } from './mockChat'
import { createStompTransport, type ChatTransport } from './transport'
import type { CreatePollInput, CreateRoomInput, MemberRole, Message, MessagePage, NotificationPage, PendingAdd, Presence, Profile, ProfileInput, Room, RoomMember, MemberRequest, Upload, UserAvatar, UserSummary } from './types'

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
  /**
   * Thêm một nhân viên đang hoạt động vào kênh; thêm lại người đã có vẫn thành công. Nhóm bật phê duyệt
   * mà mình không phải trưởng / phó nhóm thì trả về PendingAdd (chờ duyệt).
   */
  addMember(roomId: string, userId: string): Promise<Room | PendingAdd>
  /** Trưởng nhóm bật / tắt phê duyệt thành viên mới. */
  updateRoomSettings(roomId: string, settings: { requireApproval: boolean }): Promise<Room>
  /** Trưởng / phó nhóm: yêu cầu chờ duyệt. */
  listMemberRequests(roomId: string): Promise<MemberRequest[]>
  /** Duyệt (thêm vào nhóm) hoặc từ chối; trả về các yêu cầu còn lại. */
  decideMemberRequest(roomId: string, requestId: string, approve: boolean): Promise<MemberRequest[]>
  /** Đổi tên kênh (mọi thành viên, kênh chưa lưu trữ). */
  renameRoom(roomId: string, name: string): Promise<Room>
  /** Biệt danh cho người kia trong DM; chuỗi rỗng = bỏ. Chỉ mình thấy. */
  setNickname(roomId: string, nickname: string): Promise<Room>
  /** Ảnh nhóm JPEG/PNG ≤ 2 MiB. */
  uploadRoomAvatar(roomId: string, file: File): Promise<Room>
  removeRoomAvatar(roomId: string): Promise<Room>
  /** Tìm tin trong phòng theo từ khoá, mới nhất trước; `before` = ID tin cuối trang trước. */
  searchMessages(roomId: string, query: string, before?: string): Promise<MessagePage>
  /** Trưởng nhóm bổ nhiệm / bỏ phó nhóm; trả về danh sách thành viên mới. */
  setMemberRole(roomId: string, userId: string, role: Exclude<MemberRole, 'owner'>): Promise<RoomMember[]>
  createPoll(roomId: string, input: CreatePollInput): Promise<Message>
  /** Đặt lại toàn bộ lựa chọn của mình; [] = bỏ bình chọn. */
  vote(pollId: string, optionIds: string[]): Promise<Message>
  /** Những tài khoản đã có ảnh đại diện. */
  listUserAvatars(): Promise<UserAvatar[]>
  uploadMyAvatar(file: File): Promise<UserAvatar>
  removeMyAvatar(): Promise<UserAvatar>
  getMyProfile(): Promise<Profile>
  /** Hồ sơ người khác: giới tính / ngày sinh / điện thoại chỉ có khi họ để công khai. */
  getUserProfile(userId: string): Promise<Profile>
  /** Người tạo, trưởng nhóm, phó nhóm khoá bình chọn. */
  closePoll(pollId: string): Promise<Message>
  /** Chuỗi rỗng = xoá thông tin tuỳ chọn. */
  updateMyProfile(input: ProfileInput): Promise<Profile>
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
  updateRoomSettings: (roomId, settings) =>
    authRequest(`/api/rooms/${encodeURIComponent(roomId)}/settings`, { method: 'PATCH', body: settings }),
  listMemberRequests: async (roomId) =>
    (await authRequest<{ requests: MemberRequest[] }>(`/api/rooms/${encodeURIComponent(roomId)}/requests`)).requests,
  decideMemberRequest: async (roomId, requestId, approve) =>
    (
      await authRequest<{ requests: MemberRequest[] }>(
        `/api/rooms/${encodeURIComponent(roomId)}/requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'reject'}`,
        { method: 'POST' },
      )
    ).requests,
  renameRoom: (roomId, name) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', body: { name } }),
  setNickname: (roomId, nickname) =>
    authRequest(`/api/rooms/${encodeURIComponent(roomId)}/nickname`, { method: 'PUT', body: { nickname } }),
  uploadRoomAvatar: (roomId, file) => {
    const form = new FormData()
    form.append('file', file)
    return authUpload(`/api/rooms/${encodeURIComponent(roomId)}/avatar`, form)
  },
  removeRoomAvatar: (roomId) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}/avatar`, { method: 'DELETE' }),
  searchMessages: (roomId, query, before) => {
    const params = new URLSearchParams({ q: query, limit: '20' })
    if (before) params.set('before', before)
    return authRequest(`/api/rooms/${encodeURIComponent(roomId)}/search?${params}`)
  },
  setMemberRole: async (roomId, userId, role) =>
    (
      await authRequest<{ members: RoomMember[] }>(
        `/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}/role`,
        { method: 'PUT', body: { role } },
      )
    ).members,
  createPoll: (roomId, input) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}/polls`, { method: 'POST', body: input }),
  vote: (pollId, optionIds) => authRequest(`/api/polls/${encodeURIComponent(pollId)}/votes`, { method: 'PUT', body: { optionIds } }),
  listUserAvatars: async () => (await authRequest<{ avatars: UserAvatar[] }>('/api/users/avatars')).avatars,
  uploadMyAvatar: (file) => {
    const form = new FormData()
    form.append('file', file)
    return authUpload('/api/me/avatar', form)
  },
  removeMyAvatar: () => authRequest('/api/me/avatar', { method: 'DELETE' }),
  getMyProfile: () => authRequest('/api/me/profile'),
  getUserProfile: (userId) => authRequest(`/api/users/${encodeURIComponent(userId)}/profile`),
  closePoll: (pollId) => authRequest(`/api/polls/${encodeURIComponent(pollId)}/close`, { method: 'POST' }),
  updateMyProfile: (input) => authRequest('/api/me/profile', { method: 'PUT', body: input }),
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
