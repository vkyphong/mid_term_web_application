import { config } from '../../config'
import { authRequest } from '../../lib/apiClient'
import { createMockChat } from './mockChat'
import { createStompTransport, type ChatTransport } from './transport'
import type { CreateRoomInput, MessagePage, Presence, Room, UserSummary } from './types'

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
}

const mock = config.useMockApi ? createMockChat() : null

export const chatApi: ChatApi = mock ? mock.api : httpChatApi
export const chatTransport: ChatTransport = mock ? mock.transport : createStompTransport()
