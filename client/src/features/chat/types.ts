/** Kiểu dữ liệu theo docs/api/chat.md. */

export interface UserSummary {
  id: string
  displayName: string
  email: string
}

export type RoomType = 'channel' | 'dm'

export interface Room {
  id: string
  type: RoomType
  name: string
  description: string | null
  memberCount: number
  joined: boolean
  peer: UserSummary | null
  lastMessageAt: string | null
}

export interface Message {
  id: string
  roomId: string
  clientMsgId: string | null
  sender: { id: string; displayName: string }
  content: string
  createdAt: string
  editedAt?: string
  deletedAt?: string
  /** Số người nhận (snapshot thành viên lúc gửi, trừ người gửi) đã nhận / đã xem. */
  receipts?: Receipts
  reactions?: { userId: string; emoji: string }[]
}

export interface Receipts {
  recipients: number
  delivered: number
  seen: number
}

/** F06: trạng thái online của một user. */
export interface Presence {
  userId: string
  online: boolean
  lastSeen: string | null
}

/** F07: payload của typing:start / typing:stop. */
export interface TypingPayload {
  roomId: string
  userId: string
  typing: boolean
  ttlMs: number
}

/** Tin trong cache của FE: tin từ server, hoặc bản tạm đang gửi / gửi lỗi. */
export interface ChatMessage extends Message {
  status?: 'sending' | 'failed'
}

export interface MessagePage {
  messages: Message[]
  nextCursor: string | null
}

export interface CreateRoomInput {
  name: string
  description?: string
}

/** Event client gửi lên và dữ liệu ack tương ứng. */
export interface ClientEvents {
  'room:join': { payload: { roomId: string }; ack: Room }
  'room:leave': { payload: { roomId: string }; ack: { roomId: string } }
  'message:send': { payload: { roomId: string; content: string; clientMsgId: string }; ack: Message }
  'typing:start': { payload: { roomId: string }; ack: TypingPayload }
  'typing:stop': { payload: { roomId: string }; ack: TypingPayload }
  'message:delivered': { payload: { messageId: string }; ack: Message }
  'message:seen': { payload: { messageId: string }; ack: Message }
}

export type ClientEventType = keyof ClientEvents

/** Event server đẩy xuống /user/queue/events, /presence, /typing. */
export type ServerEvent =
  | { type: 'message:new' | 'message:delivered' | 'message:seen'; payload: Message; ts: string }
  | { type: 'presence:update'; payload: Presence; ts: string }
  | { type: 'typing:start' | 'typing:stop'; payload: TypingPayload; ts: string }

export const SERVER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message:new', 'message:delivered', 'message:seen', 'presence:update', 'typing:start', 'typing:stop',
])
