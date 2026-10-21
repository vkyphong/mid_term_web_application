import { config } from '../../config'
import { authRequest } from '../../lib/apiClient'
import { createMockChat } from './mockChat'
import { createStompTransport, type ChatTransport } from './transport'
import type { CreateRoomInput, MessagePage, Room, UserSummary } from './types'

export const HISTORY_PAGE_SIZE = 30

export interface ChatApi {
  listRooms(): Promise<Room[]>
  createRoom(input: CreateRoomInput): Promise<Room>
  searchUsers(search: string): Promise<UserSummary[]>
  openDm(userId: string): Promise<Room>
  /** Trang tin mới nhất (F05 sẽ thêm cuộn lên tải tiếp bằng `before`). */
  listMessages(roomId: string): Promise<MessagePage>
}

export const httpChatApi: ChatApi = {
  listRooms: async () => (await authRequest<{ rooms: Room[] }>('/api/rooms')).rooms,
  createRoom: (input) => authRequest('/api/rooms', { method: 'POST', body: input }),
  searchUsers: async (search) => {
    const params = new URLSearchParams({ search, limit: '20' })
    return (await authRequest<{ users: UserSummary[] }>(`/api/users?${params}`)).users
  },
  openDm: (userId) => authRequest('/api/dms', { method: 'POST', body: { userId } }),
  listMessages: (roomId) =>
    authRequest(`/api/rooms/${encodeURIComponent(roomId)}/messages?limit=${HISTORY_PAGE_SIZE}`),
}

const mock = config.useMockApi ? createMockChat() : null

export const chatApi: ChatApi = mock ? mock.api : httpChatApi
export const chatTransport: ChatTransport = mock ? mock.transport : createStompTransport()
