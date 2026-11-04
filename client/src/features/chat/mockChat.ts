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
import { REACTION_EMOJIS, type Gender, type MemberRole, type Message, type Notification, type Presence, type Room, type ServerEvent, type UserSummary } from './types'

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
  archived?: boolean
  /** userId → biệt danh người đó đặt cho người kia (DM). */
  nicknames?: Record<string, string>
  /** Thời điểm đổi ảnh nhóm; ảnh nằm trong uploadBlobs với khoá `avatar:<roomId>`. */
  avatarAt?: string | null
  /** userId → vai trò (thiếu = thành viên). */
  roles?: Record<string, MemberRole>
  requireApproval?: boolean
  /** Yêu cầu thêm người chờ trưởng / phó nhóm duyệt. */
  requests?: { id: string; userId: string; requestedBy: string; createdAt: string }[]
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

/** Nội dung file chỉ giữ trong bộ nhớ của tab đã upload (localStorage không đủ chỗ cho file lớn). */
const uploadBlobs = new Map<string, Blob>()
/** Mock: giới tính / ngày sinh / điện thoại chỉ giữ trong bộ nhớ tab. */
const mockProfiles = new Map<string, { gender: Gender | ''; birthDate: string; phone: string; profilePublic: boolean }>()
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
/** Đuôi file BE chấp nhận → MIME (BE tự xác định MIME, không tin trình duyệt). */
const UPLOAD_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
}

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
  const users = listMockUsers()
  const peerId = room.type === 'dm' ? room.members.find((id) => id !== userId) : undefined
  const peer = peerId ? (users.find((u) => u.id === peerId) ?? null) : null
  const nickname = room.type === 'dm' ? (room.nicknames?.[userId] ?? null) : null
  const joined = room.members.includes(userId)
  const previewMembers =
    room.type === 'channel' && joined
      ? [...room.members]
          .sort((a, b) => Number(a === userId) - Number(b === userId))
          .map((id) => users.find((u) => u.id === id))
          .filter((u): u is UserSummary => Boolean(u))
          .slice(0, 3)
      : []
  return {
    id: room.id,
    type: room.type,
    name: room.type === 'dm' ? (nickname ?? peer?.displayName ?? 'Người dùng') : room.name,
    nickname,
    previewMembers,
    avatarUrl: room.type === 'channel' && room.avatarAt ? `/api/rooms/${room.id}/avatar?v=${Date.parse(room.avatarAt)}` : null,
    description: room.description,
    memberCount: room.members.length,
    joined: room.members.includes(userId),
    peer,
    lastMessageAt: room.lastMessageAt,
    archived: Boolean(room.archived),
    myRole: room.type === 'channel' && joined ? (room.roles?.[userId] ?? 'member') : null,
    requireApproval: Boolean(room.requireApproval),
    pendingRequests: ['owner', 'deputy'].includes(room.roles?.[userId] ?? '') ? (room.requests?.length ?? 0) : 0,
    unreadCount: room.members.includes(userId) ? unreadCount(room.id, userId) : 0,
  }
}

/** Như BE: tin của người khác chưa xem, mới hơn tin cuối mình đã xem hoặc đã gửi. */
function unreadCount(roomId: string, userId: string): number {
  const store = load()
  const list = store.messages[roomId] ?? []
  const receipt = (id: string) => store.receipts?.[id]
  let mark = ''
  for (const m of list) {
    if (m.sender.id === userId || receipt(m.id)?.seen.includes(userId)) mark = m.createdAt > mark ? m.createdAt : mark
  }
  return list.filter((m) => {
    const r = receipt(m.id)
    return !m.deletedAt && m.createdAt > mark && Boolean(r?.recipients.includes(userId)) && !r?.seen.includes(userId)
  }).length
}

function mockRequests(room: StoredRoom) {
  const users = listMockUsers()
  const summary = (id: string) => users.find((u) => u.id === id) ?? { id, displayName: 'Người dùng', email: '' }
  return (room.requests ?? []).map((r) => ({ id: r.id, user: summary(r.userId), requestedBy: summary(r.requestedBy), createdAt: r.createdAt }))
}

function findRoom(store: Store, roomId: string): StoredRoom {
  const room = store.rooms.find((r) => r.id === roomId)
  if (!room) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Room not found' })
  return room
}

function requireMember(room: StoredRoom, userId: string) {
  if (!room.members.includes(userId)) throw new ApiError(403, { code: 'forbidden', message: 'Not a member' })
}

/** Group lưu trữ chặn gửi tin, join, thêm thành viên, upload (như BE). */
function requireWritable(room: StoredRoom) {
  if (room.archived) throw new ApiError(409, { code: 'invalid_payload', reason: 'room_archived', message: 'Room is archived' })
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

  /** Đổi / xoá ảnh nhóm (file chỉ giữ trong bộ nhớ tab, như file đính kèm). */
  const setMockAvatar = (roomId: string, file: File | null) => {
    const user = currentUser()
    const store = load()
    const room = findRoom(store, roomId)
    requireMember(room, user.id)
    if (room.type !== 'channel') throw new ApiError(403, { code: 'forbidden', message: 'Channels only' })
    requireWritable(room)
    if (file) {
      if (!/\.(png|jpe?g)$/i.test(file.name)) throw invalid('file', 'Avatar must be a JPEG or PNG image')
      if (file.size < 1 || file.size > 2 * 1024 * 1024) throw invalid('file', 'Avatar must contain 1–2097152 bytes')
      uploadBlobs.set(`avatar:${roomId}`, file)
    } else uploadBlobs.delete(`avatar:${roomId}`)
    room.avatarAt = file ? new Date().toISOString() : null
    save(store)
    for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
    return toRoom(room, user.id)
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
        id: uuid(), type: 'channel', name, description, members: [user.id], lastMessageAt: null, roles: { [user.id]: 'owner' },
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
      return room.members
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is UserSummary => Boolean(u))
        .map((u) => ({ ...u, enabled: true, memberRole: room.roles?.[u.id] ?? ('member' as const) }))
    },

    async addMember(roomId, userId) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      if (room.type !== 'channel') throw new ApiError(403, { code: 'forbidden', message: 'Channels only' })
      requireWritable(room)
      if (!listMockUsers().some((u) => u.id === userId)) throw invalid('userId', 'Người dùng không tồn tại')
      const leader = ['owner', 'deputy'].includes(room.roles?.[user.id] ?? '')
      if (room.requireApproval && !leader && !room.members.includes(userId)) {
        room.requests ??= []
        if (!room.requests.some((r) => r.userId === userId)) {
          room.requests.push({ id: uuid(), userId, requestedBy: user.id, createdAt: new Date().toISOString() })
        }
        save(store)
        for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
        const request = mockRequests(room).find((r) => r.user.id === userId)!
        return { pending: true as const, request, room: toRoom(room, user.id) }
      }
      const added = !room.members.includes(userId)
      if (added) room.members.push(userId)
      save(store)
      if (added) emit({ type: 'room:added', payload: toRoom(room, userId), ts: new Date().toISOString() }, userId)
      return toRoom(room, user.id)
    },

    async updateRoomSettings(roomId, settings) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      if (room.roles?.[user.id] !== 'owner') throw new ApiError(403, { code: 'forbidden', message: 'Owner only' })
      room.requireApproval = settings.requireApproval
      save(store)
      for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
      return toRoom(room, user.id)
    },

    async listMemberRequests(roomId) {
      await delay(40)
      const user = currentUser()
      const room = findRoom(load(), roomId)
      if (!['owner', 'deputy'].includes(room.roles?.[user.id] ?? '')) throw new ApiError(403, { code: 'forbidden', message: 'Leaders only' })
      return mockRequests(room)
    },

    async decideMemberRequest(roomId, requestId, approve) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      if (!['owner', 'deputy'].includes(room.roles?.[user.id] ?? '')) throw new ApiError(403, { code: 'forbidden', message: 'Leaders only' })
      const request = room.requests?.find((r) => r.id === requestId)
      if (!request) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Request not found' })
      room.requests = room.requests!.filter((r) => r.id !== requestId)
      if (approve && !room.members.includes(request.userId)) {
        room.members.push(request.userId)
        emit({ type: 'room:added', payload: toRoom(room, request.userId), ts: new Date().toISOString() }, request.userId)
      }
      save(store)
      for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
      return mockRequests(room)
    },

    async renameRoom(roomId, name) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      if (room.type !== 'channel') throw new ApiError(403, { code: 'forbidden', message: 'Channels only' })
      requireWritable(room)
      const trimmed = name.trim()
      if (trimmed.length < 2 || trimmed.length > 40) throw invalid('name', 'Tên kênh cần 2–40 ký tự')
      if (store.rooms.some((r) => r.id !== roomId && r.type === 'channel' && r.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new ApiError(409, { code: 'invalid_payload', reason: 'room_name_taken', message: 'Channel exists' })
      }
      room.name = trimmed
      save(store)
      for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
      return toRoom(room, user.id)
    },

    async setNickname(roomId, nickname) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      if (room.type !== 'dm') throw invalid('nickname', 'Chỉ đặt biệt danh trong tin nhắn riêng')
      const trimmed = nickname.trim()
      if (trimmed.length > 40) throw invalid('nickname', 'Biệt danh tối đa 40 ký tự')
      room.nicknames = { ...room.nicknames }
      if (trimmed) room.nicknames[user.id] = trimmed
      else delete room.nicknames[user.id]
      save(store)
      emit({ type: 'room:updated', payload: toRoom(room, user.id), ts: new Date().toISOString() }, user.id)
      return toRoom(room, user.id)
    },

    async uploadRoomAvatar(roomId, file) {
      await delay()
      return setMockAvatar(roomId, file)
    },

    async searchMessages(roomId, query, before) {
      await delay()
      const user = currentUser()
      const store = load()
      requireMember(findRoom(store, roomId), user.id)
      const q = query.trim().toLowerCase()
      if (!q) throw invalid('q', 'Search must contain 1–100 characters')
      const matches = (store.messages[roomId] ?? []).filter((m) => !m.deletedAt && m.content.toLowerCase().includes(q)).reverse()
      const start = before ? matches.findIndex((m) => m.id === before) + 1 : 0
      const page = matches.slice(start, start + 20)
      return { messages: page.map((m) => withReceipts(store, m)), nextCursor: start + 20 < matches.length ? page[page.length - 1].id : null }
    },

    async setMemberRole(roomId, userId, role) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      if (room.roles?.[user.id] !== 'owner') throw new ApiError(403, { code: 'forbidden', message: 'Owner only' })
      if (!room.members.includes(userId) || room.roles?.[userId] === 'owner') throw invalid('userId', 'Invalid member')
      const deputies = Object.values(room.roles ?? {}).filter((r) => r === 'deputy').length
      if (role === 'deputy' && room.roles?.[userId] !== 'deputy' && deputies >= 5) {
        throw new ApiError(409, { code: 'invalid_payload', reason: 'deputy_limit', message: 'At most 5 deputies' })
      }
      room.roles = { ...room.roles, [userId]: role }
      save(store)
      for (const member of room.members) emit({ type: 'room:updated', payload: toRoom(room, member), ts: new Date().toISOString() }, member)
      return api.listMembers(roomId)
    },

    async createPoll(roomId, input) {
      await delay()
      const user = currentUser()
      const store = load()
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      requireWritable(room)
      const options = input.options.map((o) => o.trim()).filter(Boolean)
      if (!input.question.trim() || options.length < 2) throw invalid('options', 'A poll needs 2–10 options')
      const message: Message = {
        id: uuid(), roomId, clientMsgId: uuid(), sender: { id: user.id, displayName: user.displayName },
        content: `📊 ${input.question.trim()}`, createdAt: new Date().toISOString(), reactions: [], attachment: null,
        poll: { id: uuid(), question: input.question.trim(), multiple: input.multiple, createdBy: user.id, options: options.map((label) => ({ id: uuid(), label, voters: [] })) },
      }
      ;(store.messages[roomId] ??= []).push(message)
      room.lastMessageAt = message.createdAt
      ;(store.receipts ??= {})[message.id] = { recipients: room.members.filter((id) => id !== user.id), delivered: [], seen: [] }
      save(store)
      setTimeout(() => emit({ type: 'message:new', payload: message, ts: new Date().toISOString() }), 0)
      return message
    },

    async vote(pollId, optionIds) {
      await delay(60)
      const user = currentUser()
      const store = load()
      const message = Object.values(store.messages).flat().find((m) => m.poll?.id === pollId)
      if (!message?.poll) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Poll not found' })
      requireMember(findRoom(store, message.roomId), user.id)
      if (!message.poll.multiple && optionIds.length > 1) throw invalid('optionIds', 'Choose one option')
      for (const option of message.poll.options) {
        option.voters = option.voters.filter((id) => id !== user.id)
        if (optionIds.includes(option.id)) option.voters.push(user.id)
      }
      save(store)
      const updated = withReceipts(store, message)
      setTimeout(() => emit({ type: 'message:poll', payload: updated, ts: new Date().toISOString() }), 0)
      return updated
    },

    async listUserAvatars() {
      await delay(40)
      return [...uploadBlobs.keys()].filter((k) => k.startsWith('user:')).map((k) => ({ userId: k.slice(5), avatarUrl: `/api/users/${k.slice(5)}/avatar?v=1` }))
    },

    async uploadMyAvatar(file) {
      await delay()
      const user = currentUser()
      if (!/\.(png|jpe?g)$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw invalid('file', 'Avatar must be a JPEG or PNG image')
      uploadBlobs.set(`user:${user.id}`, file)
      const avatar = { userId: user.id, avatarUrl: `/api/users/${user.id}/avatar?v=${Date.now()}` }
      emit({ type: 'user:avatar', payload: avatar, ts: new Date().toISOString() })
      return avatar
    },

    async getMyProfile() {
      await delay(40)
      const user = currentUser()
      const extra = mockProfiles.get(user.id)
      return {
        id: user.id, email: user.email, displayName: user.displayName, gender: extra?.gender || null,
        birthDate: extra?.birthDate || null, phone: extra?.phone || null,
        avatarUrl: uploadBlobs.has(`user:${user.id}`) ? `/api/users/${user.id}/avatar?v=1` : null,
        profilePublic: Boolean(extra?.profilePublic), self: true,
      }
    },

    async getUserProfile(userId) {
      await delay(40)
      const me = currentUser()
      if (userId === me.id) return { ...(await api.getMyProfile()), self: true }
      const user = listMockUsers().find((u) => u.id === userId)
      if (!user) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Employee not found' })
      const extra = mockProfiles.get(userId)
      const open = Boolean(extra?.profilePublic)
      return {
        id: user.id, email: user.email, displayName: user.displayName, gender: open ? extra?.gender || null : null,
        birthDate: open ? extra?.birthDate || null : null, phone: open ? extra?.phone || null : null,
        avatarUrl: uploadBlobs.has(`user:${userId}`) ? `/api/users/${userId}/avatar?v=1` : null, profilePublic: open, self: false,
      }
    },

    async closePoll(pollId) {
      await delay(60)
      const user = currentUser()
      const store = load()
      const message = Object.values(store.messages).flat().find((m) => m.poll?.id === pollId)
      if (!message?.poll) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Poll not found' })
      const room = findRoom(store, message.roomId)
      requireMember(room, user.id)
      const role = room.roles?.[user.id]
      if (message.poll.createdBy !== user.id && role !== 'owner' && role !== 'deputy') throw new ApiError(403, { code: 'forbidden', message: 'Not allowed' })
      message.poll.closedAt ??= new Date().toISOString()
      message.poll.closedBy ??= user.id
      save(store)
      const updated = withReceipts(store, message)
      setTimeout(() => emit({ type: 'message:poll', payload: updated, ts: new Date().toISOString() }), 0)
      return updated
    },

    async updateMyProfile(input) {
      await delay()
      const user = currentUser()
      if (input.displayName.trim().length < 2 || input.displayName.trim().length > 50) throw invalid('displayName', 'Tên hiển thị cần 2–50 ký tự')
      mockProfiles.set(user.id, { gender: input.gender, birthDate: input.birthDate, phone: input.phone.trim(), profilePublic: input.profilePublic ?? mockProfiles.get(user.id)?.profilePublic ?? false })
      return { ...(await api.getMyProfile()), displayName: input.displayName.trim() }
    },

    async removeMyAvatar() {
      await delay()
      const user = currentUser()
      uploadBlobs.delete(`user:${user.id}`)
      const avatar = { userId: user.id, avatarUrl: null }
      emit({ type: 'user:avatar', payload: avatar, ts: new Date().toISOString() })
      return avatar
    },

    async removeRoomAvatar(roomId) {
      await delay()
      return setMockAvatar(roomId, null)
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
      const room = findRoom(store, roomId)
      requireMember(room, user.id)
      requireWritable(room)
      if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) throw invalid('file', `File must contain 1–${MAX_UPLOAD_BYTES} bytes`)
      const mediaType = UPLOAD_TYPES[file.name.slice(file.name.lastIndexOf('.')).toLowerCase()]
      if (!mediaType) throw invalid('file', 'Unsupported file type')
      for (const step of [0.25, 0.5, 0.75, 1]) {
        await delay(80)
        onProgress?.(step)
      }
      const id = uuid()
      uploadBlobs.set(id, file)
      ;(store.uploads ??= {})[id] = { roomId, ownerId: user.id, filename: file.name, mediaType, size: file.size, messageId: null }
      save(store)
      return { id, roomId, filename: file.name, mediaType, size: file.size, url: `/api/uploads/${id}` }
    },

    async downloadFile(url) {
      await delay(60)
      const user = currentUser()
      const avatarUser = /^\/api\/users\/([^/]+)\/avatar/.exec(url)?.[1]
      if (avatarUser) {
        const blob = uploadBlobs.get(`user:${avatarUser}`)
        if (!blob) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Avatar not found' })
        return blob
      }
      const avatarRoom = /^\/api\/rooms\/([^/]+)\/avatar/.exec(url)?.[1]
      if (avatarRoom) {
        requireMember(findRoom(load(), avatarRoom), user.id)
        const blob = uploadBlobs.get(`avatar:${avatarRoom}`)
        if (!blob) throw new ApiError(404, { code: 'invalid_payload', reason: 'not_found', message: 'Avatar not found' })
        return blob
      }
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
        if (type === 'room:join') requireWritable(room)
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
      requireWritable(room)
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
