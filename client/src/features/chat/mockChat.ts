/**
 * Mock chat chạy trong trình duyệt khi BE chưa sẵn sàng (VITE_USE_MOCK_API=true).
 * Mô phỏng docs/api/chat.md: dữ liệu chung trong localStorage, event phát giữa các tab
 * bằng BroadcastChannel. Mỗi tab có thể đăng nhập một user khác (xem mockAuthApi).
 * CHỈ dùng cho dev/demo.
 */
import { ApiError } from '../../lib/apiError'
import { getMockCurrentUser, listMockUsers } from '../auth/mockAuthApi'
import type { ChatApi } from './chatApi'
import type { ChatTransport } from './transport'
import type { Message, Room, ServerEvent, UserSummary } from './types'

const STORE_KEY = 'pulsechat.mock.chat'
const CHANNEL_NAME = 'pulsechat.mock.chat'
const SEED_CHANNELS = [
  { name: 'Engineering', description: 'Kỹ thuật và phát triển sản phẩm' },
  { name: 'HR', description: 'Nhân sự' },
  { name: 'Sales', description: 'Kinh doanh' },
  { name: 'Marketing', description: 'Truyền thông và marketing' },
]

interface StoredRoom {
  id: string
  type: 'channel' | 'dm'
  name: string
  description: string | null
  members: string[]
  lastMessageAt: string | null
}

interface Store {
  rooms: StoredRoom[]
  messages: Record<string, Message[]>
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    /* dữ liệu hỏng → tạo lại */
  }
  const store: Store = {
    rooms: SEED_CHANNELS.map((c) => ({
      id: crypto.randomUUID(),
      type: 'channel',
      name: c.name,
      description: c.description,
      members: [],
      lastMessageAt: null,
    })),
    messages: {},
  }
  save(store)
  return store
}

function save(store: Store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

function currentUser(): UserSummary {
  const user = getMockCurrentUser()
  if (!user) throw new ApiError(401, { code: 'unauthorized', message: 'Not signed in' })
  return user
}

function toRoom(room: StoredRoom, userId: string): Room {
  const peerId = room.type === 'dm' ? room.members.find((id) => id !== userId) : undefined
  const peer = peerId ? (listMockUsers().find((u) => u.id === peerId) ?? null) : null
  return {
    id: room.id,
    type: room.type,
    name: room.type === 'dm' ? (peer?.displayName ?? 'Người dùng') : room.name,
    description: room.description,
    memberCount: room.members.length,
    joined: room.members.includes(userId),
    peer,
    lastMessageAt: room.lastMessageAt,
  }
}

function findRoom(store: Store, roomId: string): StoredRoom {
  const room = store.rooms.find((r) => r.id === roomId)
  if (!room) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Room not found' })
  return room
}

function requireMember(room: StoredRoom, userId: string) {
  if (!room.members.includes(userId)) throw new ApiError(403, { code: 'forbidden', message: 'Not a member' })
}

const invalid = (field: string, message: string) =>
  new ApiError(400, { code: 'invalid_payload', reason: 'validation', message, details: [{ field, message }] })

export function createMockChat(): { api: ChatApi; transport: ChatTransport } {
  const listeners = new Set<(event: ServerEvent) => void>()
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

  // Giống BE: chỉ giao message:new cho thành viên hiện tại của phòng.
  const deliver = (event: ServerEvent) => {
    const user = getMockCurrentUser()
    if (!user) return
    const room = load().rooms.find((r) => r.id === event.payload.roomId)
    if (!room?.members.includes(user.id)) return
    for (const listener of listeners) listener(event)
  }

  channel?.addEventListener('message', (e: MessageEvent<ServerEvent>) => deliver(e.data))

  const emit = (event: ServerEvent) => {
    channel?.postMessage(event)
    deliver(event)
  }

  const api: ChatApi = {
    async listRooms() {
      await delay()
      const user = currentUser()
      return load()
        .rooms.filter((r) => r.type === 'channel' || r.members.includes(user.id))
        .map((r) => toRoom(r, user.id))
    },

    async createRoom(input) {
      await delay()
      const user = currentUser()
      const name = input.name.trim()
      const description = input.description?.trim() || null
      if (name.length < 2 || name.length > 40) throw invalid('name', 'Tên kênh cần 2–40 ký tự')
      if (description && description.length > 200) throw invalid('description', 'Mô tả tối đa 200 ký tự')
      const store = load()
      if (store.rooms.some((r) => r.type === 'channel' && r.name.toLowerCase() === name.toLowerCase())) {
        throw new ApiError(409, { code: 'invalid_payload', reason: 'room_name_taken', message: 'Channel exists' })
      }
      const room: StoredRoom = {
        id: crypto.randomUUID(), type: 'channel', name, description, members: [user.id], lastMessageAt: null,
      }
      store.rooms.push(room)
      save(store)
      return toRoom(room, user.id)
    },

    async searchUsers(search) {
      await delay()
      const user = currentUser()
      const q = search.trim().toLowerCase()
      return listMockUsers()
        .filter((u) => u.id !== user.id)
        .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.email.includes(q))
        .slice(0, 20)
    },

    async openDm(userId) {
      await delay()
      const user = currentUser()
      if (userId === user.id || !listMockUsers().some((u) => u.id === userId)) {
        throw invalid('userId', 'Người dùng không hợp lệ')
      }
      const store = load()
      let room = store.rooms.find(
        (r) => r.type === 'dm' && r.members.includes(user.id) && r.members.includes(userId),
      )
      if (!room) {
        room = { id: crypto.randomUUID(), type: 'dm', name: '', description: null, members: [user.id, userId], lastMessageAt: null }
        store.rooms.push(room)
        save(store)
      }
      return toRoom(room, user.id)
    },

    async listMessages(roomId) {
      await delay()
      const user = currentUser()
      const store = load()
      requireMember(findRoom(store, roomId), user.id)
      return { messages: (store.messages[roomId] ?? []).slice(-30), nextCursor: null }
    },
  }

  const transport: ChatTransport = {
    async request(type, payload) {
      await delay(60)
      const user = currentUser()
      const store = load()
      const room = findRoom(store, payload.roomId)

      if (type === 'room:join' || type === 'room:leave') {
        if (room.type !== 'channel') throw new ApiError(403, { code: 'forbidden', message: 'Channels only' })
        room.members =
          type === 'room:join'
            ? [...new Set([...room.members, user.id])]
            : room.members.filter((id) => id !== user.id)
        save(store)
        return (type === 'room:join' ? toRoom(room, user.id) : { roomId: room.id }) as never
      }

      // message:send
      const { content, clientMsgId } = payload as { roomId: string; content: string; clientMsgId: string }
      requireMember(room, user.id)
      const text = content.trim()
      if (!text || utf8Bytes(text) > 2048) throw invalid('content', 'Nội dung cần 1–2048 byte')
      const list = (store.messages[room.id] ??= [])
      const existing = list.find((m) => m.clientMsgId === clientMsgId && m.sender.id === user.id)
      if (existing) return existing as never
      const message: Message = {
        id: crypto.randomUUID(),
        roomId: room.id,
        clientMsgId,
        sender: { id: user.id, displayName: user.displayName },
        content: text,
        createdAt: new Date().toISOString(),
      }
      list.push(message)
      room.lastMessageAt = message.createdAt
      save(store)
      // Ack trước, rồi mới broadcast (đúng thứ tự trong contract).
      setTimeout(() => emit({ type: 'message:new', payload: message, ts: new Date().toISOString() }), 0)
      return message as never
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onConnected() {
      return () => {}
    },
  }

  return { api, transport }
}
