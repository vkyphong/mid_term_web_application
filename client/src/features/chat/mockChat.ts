import { uuid } from '../../lib/uuid'
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
import type { Message, Presence, Room, ServerEvent, UserSummary } from './types'

const STORE_KEY = 'pulsechat.mock.chat'
const PAGE_SIZE = 30 // = HISTORY_PAGE_SIZE (không import để tránh vòng chatApi ↔ mockChat)
const CHANNEL_NAME = 'pulsechat.mock.chat'
const PRESENCE_KEY = 'pulsechat.mock.presence' // userId → lần "nhịp tim" cuối (ms)
const HEARTBEAT_MS = 3_000
const OFFLINE_AFTER_MS = 8_000
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

interface StoredReceipts {
  recipients: string[]
  delivered: string[]
  seen: string[]
}

interface Store {
  rooms: StoredRoom[]
  messages: Record<string, Message[]>
  receipts?: Record<string, StoredReceipts>
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
      id: uuid(),
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

/** Gắn số đếm receipts (như BE) vào tin. */
function withReceipts(store: Store, message: Message): Message {
  const r = store.receipts?.[message.id]
  if (!r) return message
  return { ...message, receipts: { recipients: r.recipients.length, delivered: r.delivered.length, seen: r.seen.length } }
}

function readBeats(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PRESENCE_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function beat() {
  const user = getMockCurrentUser()
  if (!user) return
  localStorage.setItem(PRESENCE_KEY, JSON.stringify({ ...readBeats(), [user.id]: Date.now() }))
}

function presenceSnapshot(now = Date.now()): Presence[] {
  const beats = readBeats()
  return listMockUsers().map((u) => {
    const last = beats[u.id]
    const online = last !== undefined && now - last < OFFLINE_AFTER_MS
    return { userId: u.id, online, lastSeen: last !== undefined && !online ? new Date(last).toISOString() : null }
  })
}

const invalid = (field: string, message: string) =>
  new ApiError(400, { code: 'invalid_payload', reason: 'validation', message, details: [{ field, message }] })

export function createMockChat(): { api: ChatApi; transport: ChatTransport } {
  const listeners = new Set<(event: ServerEvent) => void>()
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

  // Giống BE: event của phòng chỉ giao cho thành viên hiện tại; presence giao cho mọi user đăng nhập.
  const deliver = (event: ServerEvent) => {
    const user = getMockCurrentUser()
    if (!user) return
    if (event.type !== 'presence:update') {
      const room = load().rooms.find((r) => r.id === event.payload.roomId)
      if (!room?.members.includes(user.id)) return
    }
    for (const listener of listeners) listener(event)
  }

  // Presence: mỗi tab tự đánh "nhịp tim" và tự so snapshot để phát presence:update cho chính nó.
  if (typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
    let previous = new Map(presenceSnapshot().map((p) => [p.userId, p.online]))
    setInterval(() => {
      beat()
      const next = presenceSnapshot()
      for (const p of next) {
        if (previous.get(p.userId) !== p.online) {
          for (const listener of listeners) listener({ type: 'presence:update', payload: p, ts: new Date().toISOString() })
        }
      }
      previous = new Map(next.map((p) => [p.userId, p.online]))
    }, HEARTBEAT_MS)
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
        id: uuid(), type: 'channel', name, description, members: [user.id], lastMessageAt: null,
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
        room = { id: uuid(), type: 'dm', name: '', description: null, members: [user.id, userId], lastMessageAt: null }
        store.rooms.push(room)
        save(store)
      }
      return toRoom(room, user.id)
    },

    async listMessages(roomId, before) {
      await delay()
      const user = currentUser()
      const store = load()
      requireMember(findRoom(store, roomId), user.id)
      // Cursor = id của tin cũ nhất trang trước (tin lưu theo thứ tự gửi).
      const all = store.messages[roomId] ?? []
      let end = all.length
      if (before) {
        end = all.findIndex((m) => m.id === before)
        if (end < 0) throw invalid('before', 'Invalid history cursor')
      }
      const start = Math.max(0, end - PAGE_SIZE)
      return {
        messages: all.slice(start, end).map((m) => withReceipts(store, m)),
        nextCursor: start > 0 ? all[start].id : null,
      }
    },

    async getPresence() {
      await delay()
      currentUser()
      beat()
      return presenceSnapshot()
    },
  }

  const transport: ChatTransport = {
    async request(type, payload) {
      await delay(60)
      const user = currentUser()
      const store = load()

      if (type === 'message:delivered' || type === 'message:seen') {
        const { messageId } = payload as { messageId: string }
        const message = Object.values(store.messages).flat().find((m) => m.id === messageId)
        if (!message) throw invalid('messageId', 'Message not found')
        requireMember(findRoom(store, message.roomId), user.id)
        const r = store.receipts?.[messageId]
        if (!r?.recipients.includes(user.id)) {
          throw new ApiError(403, { code: 'forbidden', message: 'Only original recipients may acknowledge a message' })
        }
        // Idempotent, không lùi; seen bao hàm delivered.
        if (!r.delivered.includes(user.id)) r.delivered.push(user.id)
        if (type === 'message:seen' && !r.seen.includes(user.id)) r.seen.push(user.id)
        save(store)
        const updated = withReceipts(store, message)
        setTimeout(() => emit({ type, payload: updated, ts: new Date().toISOString() }), 0)
        return updated as never
      }

      const room = findRoom(store, (payload as { roomId: string }).roomId)

      if (type === 'typing:start' || type === 'typing:stop') {
        requireMember(room, user.id)
        const data = { roomId: room.id, userId: user.id, typing: type === 'typing:start', ttlMs: 3000 }
        emit({ type, payload: data, ts: new Date().toISOString() })
        return data as never
      }

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
      if (existing) return withReceipts(store, existing) as never
      const message: Message = {
        id: uuid(),
        roomId: room.id,
        clientMsgId,
        sender: { id: user.id, displayName: user.displayName },
        content: text,
        createdAt: new Date().toISOString(),
      }
      list.push(message)
      room.lastMessageAt = message.createdAt
      // Người nhận = thành viên lúc gửi, trừ người gửi (vào sau không thành người nhận).
      ;(store.receipts ??= {})[message.id] = { recipients: room.members.filter((id) => id !== user.id), delivered: [], seen: [] }
      save(store)
      const saved = withReceipts(store, message)
      // Ack trước, rồi mới broadcast (đúng thứ tự trong contract).
      setTimeout(() => emit({ type: 'message:new', payload: saved, ts: new Date().toISOString() }), 0)
      return saved as never
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
