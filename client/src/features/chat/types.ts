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
}

export type ClientEventType = keyof ClientEvents

/** Event server đẩy xuống /user/queue/events. */
export type ServerEvent = { type: 'message:new'; payload: Message; ts: string }
