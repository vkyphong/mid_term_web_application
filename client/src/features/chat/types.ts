/** Kiểu dữ liệu theo docs/api/chat.md. */

export interface UserSummary {
  id: string
  displayName: string
  email: string
}

/** Thành viên phòng (GET /api/rooms/{id}/members); gồm cả tài khoản bị khoá. */
export interface RoomMember extends UserSummary {
  enabled?: boolean
  /** Vai trò trong nhóm (kênh): trưởng nhóm / phó nhóm / thành viên. */
  memberRole?: MemberRole
}

export type MemberRole = 'owner' | 'deputy' | 'member'

/** Ảnh đại diện tài khoản; avatarUrl null = đã xoá ảnh. */
export interface UserAvatar {
  userId: string
  avatarUrl: string | null
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
  /** Group đã lưu trữ: chỉ đọc lịch sử, không gửi tin / tham gia / thêm thành viên / upload. */
  archived?: boolean
  /** Số tin của người khác chưa xem (server tính theo receipts). */
  unreadCount?: number
  /** DM: biệt danh mình đặt cho người kia (khi có thì `name` là biệt danh, tên thật ở `peer`). */
  nickname?: string | null
  /** Kênh: ảnh nhóm (tải bằng Bearer); null = dùng avatar ghép từ thành viên. */
  avatarUrl?: string | null
  /** Kênh: tối đa 3 thành viên cho avatar mặc định, người khác trước mình. */
  previewMembers?: UserSummary[]
  /** Kênh đã tham gia: vai trò của mình. */
  myRole?: MemberRole | null
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
  /** F15: tệp đính kèm (tải qua REST có Bearer). */
  attachment?: Attachment | null
  /** Bình chọn gắn với tin này. */
  poll?: Poll | null
}

export interface PollOption {
  id: string
  label: string
  /** userId đã chọn phương án này. */
  voters: string[]
}

export interface Poll {
  id: string
  question: string
  /** Cho chọn nhiều phương án. */
  multiple: boolean
  createdBy: string
  options: PollOption[]
}

export interface CreatePollInput {
  question: string
  options: string[]
  multiple: boolean
}

export interface Attachment {
  id: string
  filename: string
  mediaType: string
  size: number
  url: string
}

/** Kết quả POST /api/uploads. */
export interface Upload extends Attachment {
  roomId: string
}

/** F09. */
export interface Notification {
  id: string
  type: 'mention' | 'dm' | 'system'
  roomId?: string | null
  messageId?: string | null
  content: string
  createdAt: string
  readAt?: string | null
}

export interface NotificationPage {
  notifications: Notification[]
  nextCursor: string | null
  unreadCount: number
}

/** F14: emoji server cho phép. */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'] as const

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

/** Tin trong cache của FE: tin từ server, hoặc bản tạm đang gửi / chờ mạng / gửi lỗi. */
export interface ChatMessage extends Message {
  status?: 'sending' | 'queued' | 'failed'
  /** Lý do gửi lỗi (F11), hiển thị dưới tin. */
  error?: string
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
  'whiteboard:segment': { payload: import('../whiteboard/types').SegmentInput; ack: import('../whiteboard/types').Segment }
  'whiteboard:clear': { payload: import('../whiteboard/types').ClearInput; ack: import('../whiteboard/types').Cleared }
  'room:join': { payload: { roomId: string }; ack: Room }
  'room:leave': { payload: { roomId: string }; ack: { roomId: string } }
  'message:send': {
    payload: { roomId: string; content: string; clientMsgId: string; mentions?: string[]; uploadId?: string }
    ack: Message
  }
  'message:edit': { payload: { messageId: string; content: string }; ack: Message }
  'message:delete': { payload: { messageId: string }; ack: Message }
  'message:react': { payload: { messageId: string; emoji: string; active: boolean }; ack: Message }
  'typing:start': { payload: { roomId: string }; ack: TypingPayload }
  'typing:stop': { payload: { roomId: string }; ack: TypingPayload }
  'message:delivered': { payload: { messageId: string }; ack: Message }
  'message:seen': { payload: { messageId: string }; ack: Message }
}

export type ClientEventType = keyof ClientEvents

/** Event server đẩy xuống /user/queue/events, /presence, /typing. */
export type ServerEvent =
  | import('../whiteboard/types').BoardEvent
  | {
      type: 'message:new' | 'message:delivered' | 'message:seen' | 'message:edit' | 'message:delete' | 'message:react' | 'message:poll'
      payload: Message
      ts: string
    }
  | { type: 'notification:new'; payload: Notification; ts: string }
  /** Mình vừa được thêm vào kênh (POST /api/rooms/{id}/members hoặc admin). */
  | { type: 'room:added'; payload: Room; ts: string }
  /** Tên / ảnh nhóm đổi, hoặc mình đổi biệt danh (Room nhìn từ phía mình). */
  | { type: 'room:updated'; payload: Room; ts: string }
  /** Ai đó đổi / xoá ảnh đại diện. */
  | { type: 'user:avatar'; payload: UserAvatar; ts: string }
  | { type: 'notification:read'; payload: { id: string }; ts: string }
  | { type: 'presence:update'; payload: Presence; ts: string }
  | { type: 'typing:start' | 'typing:stop'; payload: TypingPayload; ts: string }

export const SERVER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'whiteboard:segment', 'whiteboard:cleared',
  'message:new', 'message:delivered', 'message:seen', 'message:edit', 'message:delete', 'message:react', 'message:poll', 'user:avatar',
  'presence:update', 'typing:start', 'typing:stop', 'notification:new', 'notification:read', 'room:added', 'room:updated',
])
