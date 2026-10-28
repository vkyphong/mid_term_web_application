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
import { REACTION_EMOJIS, type Message, type Notification, type Presence, type Room, type ServerEvent, type UserSummary } from './types'

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

interface StoredUpload {
  roomId: string
  ownerId: string
  filename: string
  mediaType: string
  size: number
  messageId: string | null
}

interface Store {
  rooms: StoredRoom[]
  messages: Record<string, Message[]>
  receipts?: Record<string, StoredReceipts>
  notifications?: Record<string, Notification[]> // userId → thông báo, mới nhất trước
  uploads?: Record<string, StoredUpload>
}

/** Nội dung file chỉ giữ trong bộ nhớ của tab đã upload (localStorage không đủ chỗ cho 5 MiB). */
const uploadBlobs = new Map<string, Blob>()
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

/** Gói event gửi qua BroadcastChannel; `to` = chỉ giao cho đúng user đó (thông báo). */
interface Envelope {
  to?: string
  event: ServerEvent
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

function findMessage(store: Store, messageId: string): Message {
  const message = Object.values(store.messages).flat().find((m) => m.id === messageId)
  if (!message) throw invalid('messageId', 'Message not found')
  return message
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

  // Giống BE: event của phòng chỉ giao cho thành viên hiện tại; thông báo chỉ cho đúng người nhận;
  // presence giao cho mọi user đăng nhập.
  const deliver = ({ to, event }: Envelope) => {
    const user = getMockCurrentUser()
    if (!user) return
    if (to !== undefined) {
      if (to !== user.id) return
    } else if (event.type !== 'presence:update') {
      const room = load().rooms.find((r) => r.id === (event.payload as { roomId?: string }).roomId)
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

  channel?.addEventListener('message', (e: MessageEvent<Envelope>) => deliver(e.data))

  const emit = (event: ServerEvent, to?: string) => {
    channel?.postMessage({ to, event })
    deliver({ to, event })
  }

  const notify = (store: Store, userId: string, data: Omit<Notification, 'id' | 'createdAt' | 'readAt'>) => {
    const n: Notification = { id: uuid(), createdAt: new Date().toISOString(), readAt: null, ...data }
    const list = ((store.notifications ??= {})[userId] ??= [])
    list.unshift(n)
    setTimeout(() => emit({ type: 'notification:new', payload: n, ts: new Date().toISOString() }, userId), 0)
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

    async listMembers(roomId) {
      await delay()
      const user = currentUser()
      const room = findRoom(load(), roomId)
      requireMember(room, user.id)
      const users = listMockUsers()
      return room.members.map((id) => users.find((u) => u.id === id)).filter((u): u is UserSummary => Boolean(u))
    },

    async listNotifications(before) {
      await delay()
      const user = currentUser()
      const store = load()
      const visible = (store.notifications?.[user.id] ?? []).filter(
        (n) => !n.roomId || store.rooms.find((r) => r.id === n.roomId)?.members.includes(user.id),
      )
      const start = before ? visible.findIndex((n) => n.id === before) + 1 : 0
      const page = visible.slice(start, start + 30)
      return {
        notifications: page,
        nextCursor: start + 30 < visible.length ? page[page.length - 1].id : null,
        unreadCount: visible.filter((n) => !n.readAt).length,
      }
    },

    async markNotificationRead(id) {
      await delay(60)
      const user = currentUser()
      const store = load()
      const n = store.notifications?.[user.id]?.find((x) => x.id === id)
      if (!n) throw invalid('id', 'Notification not found')
      n.readAt ??= new Date().toISOString()
      save(store)
      emit({ type: 'notification:read', payload: { id }, ts: new Date().toISOString() }, user.id)
    },

    async uploadFile(roomId, file, onProgress) {
      const user = currentUser()
      const store = load()
      requireMember(findRoom(store, roomId), user.id)
      if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) throw invalid('file', 'File must contain 1–5242880 bytes')
      if (!UPLOAD_TYPES.includes(file.type)) throw invalid('file', 'Only JPEG, PNG and PDF signatures are accepted')
      for (const step of [0.25, 0.5, 0.75, 1]) {
        await delay(80)
        onProgress?.(step)
      }
      const id = uuid()
      uploadBlobs.set(id, file)
      ;(store.uploads ??= {})[id] = { roomId, ownerId: user.id, filename: file.name, mediaType: file.type, size: file.size, messageId: null }
      save(store)
      return { id, roomId, filename: file.name, mediaType: file.type, size: file.size, url: `/api/uploads/${id}` }
    },

    async downloadFile(url) {
      await delay(60)
      const user = currentUser()
      const id = url.split('/').pop() ?? ''
      const store = load()
      const meta = store.uploads?.[id]
      if (!meta) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'File not found' })
      requireMember(findRoom(store, meta.roomId), user.id)
      const blob = uploadBlobs.get(id)
      if (!blob) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Mock: file chỉ có ở tab đã upload' })
      return blob
    },
  }

  const transport: ChatTransport = {
    async request(type, payload) {
      if (type === 'whiteboard:segment' || type === 'whiteboard:clear') throw new ApiError(400, { code: 'invalid_payload', message: 'Whiteboard requires the real backend' })
      await delay(60)
      const user = currentUser()
      const store = load()

      if (type === 'message:edit' || type === 'message:delete' || type === 'message:react') {
        const { messageId, content, emoji, active } = payload as { messageId: string; content?: string; emoji?: string; active?: boolean }
        const message = findMessage(store, messageId)
        requireMember(findRoom(store, message.roomId), user.id)
        if (type !== 'message:react' && message.sender.id !== user.id) {
          throw new ApiError(403, { code: 'forbidden', message: 'Only the author may edit or delete' })
        }
        if (message.deletedAt && type !== 'message:delete') throw invalid('messageId', 'Message was deleted')
        if (type === 'message:edit') {
          const text = (content ?? '').trim()
          if (!text || utf8Bytes(text) > 2048) throw invalid('content', 'Use 1–2048 UTF-8 bytes')
          message.content = text
          message.editedAt = new Date().toISOString()
        } else if (type === 'message:delete') {
          message.content = ''
          message.deletedAt ??= new Date().toISOString()
          message.reactions = []
          message.attachment = null
        } else {
          if (!emoji || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) throw invalid('emoji', 'Unsupported reaction')
          const others = (message.reactions ?? []).filter((r) => !(r.userId === user.id && r.emoji === emoji))
          // active=true thêm, false bỏ: gửi lại không bị đảo trạng thái.
          message.reactions = active ? [...others, { userId: user.id, emoji }] : others
        }
        save(store)
        const updated = withReceipts(store, message)
        setTimeout(() => emit({ type, payload: updated, ts: new Date().toISOString() }), 0)
        return updated as never
      }

      if (type === 'message:delivered' || type === 'message:seen') {
        const { messageId } = payload as { messageId: string }
        const message = findMessage(store, messageId)
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
      const { content, clientMsgId, mentions = [], uploadId } = payload as {
        roomId: string; content: string; clientMsgId: string; mentions?: string[]; uploadId?: string
      }
      requireMember(room, user.id)
      const text = content.trim()
      if ((!text && !uploadId) || utf8Bytes(text) > 2048) throw invalid('content', 'Nội dung cần 1–2048 byte')
      const list = (store.messages[room.id] ??= [])
      const existing = list.find((m) => m.clientMsgId === clientMsgId && m.sender.id === user.id)
      if (existing) return withReceipts(store, existing) as never
      if (mentions.length > 20 || new Set(mentions).size !== mentions.length) throw invalid('mentions', 'At most 20 distinct member IDs')
      for (const id of mentions) requireMember(room, id)
      const upload = uploadId ? store.uploads?.[uploadId] : undefined
      if (uploadId && (!upload || upload.ownerId !== user.id || upload.roomId !== room.id || upload.messageId)) {
        throw invalid('uploadId', 'Upload must be unused, owned by sender and belong to this room')
      }
      const message: Message = {
        id: uuid(),
        roomId: room.id,
        clientMsgId,
        sender: { id: user.id, displayName: user.displayName },
        content: text,
        createdAt: new Date().toISOString(),
        reactions: [],
        attachment: upload && uploadId
          ? { id: uploadId, filename: upload.filename, mediaType: upload.mediaType, size: upload.size, url: `/api/uploads/${uploadId}` }
          : null,
      }
      if (upload) upload.messageId = message.id
      list.push(message)
      room.lastMessageAt = message.createdAt
      // Người nhận = thành viên lúc gửi, trừ người gửi (vào sau không thành người nhận).
      ;(store.receipts ??= {})[message.id] = { recipients: room.members.filter((id) => id !== user.id), delivered: [], seen: [] }
      // Thông báo như BE: DM cho người còn lại; kênh cho người được @mention (trừ chính mình).
      for (const recipient of room.members.filter((id) => id !== user.id)) {
        const kind = room.type === 'dm' ? 'dm' : mentions.includes(recipient) ? 'mention' : null
        if (kind) notify(store, recipient, { type: kind, roomId: room.id, messageId: message.id, content: text })
      }
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
    isConnected: () => true,
  }

  return { api, transport }
}
