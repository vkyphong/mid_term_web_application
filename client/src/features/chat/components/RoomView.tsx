import { Link } from 'react-router-dom'
import { useSession } from '../../auth/hooks'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useJoinRoom, useLeaveRoom, useMessages, useRooms, useSendMessage } from '../hooks'
import type { Room } from '../types'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

function JoinPrompt({ room }: { room: Room }) {
  const join = useJoinRoom()
  return (
    <div className="room-empty">
      <h2># {room.name}</h2>
      {room.description && <p className="muted">{room.description}</p>}
      <p className="muted">{room.memberCount} thành viên · Bạn chưa tham gia kênh này.</p>
      {join.error && <FormAlert>{describeChatError(join.error)}</FormAlert>}
      <button type="button" className="btn-primary btn-inline" disabled={join.isPending} onClick={() => join.mutate(room.id)}>
        {join.isPending ? 'Đang tham gia…' : 'Tham gia kênh'}
      </button>
    </div>
  )
}

function Conversation({ room }: { room: Room }) {
  const { user } = useSession()
  const messages = useMessages(room.id, true)
  const { send, retry } = useSendMessage(room.id)
  const leave = useLeaveRoom()

  return (
    <>
      <header className="room-header">
        <Link to="/" className="back-link" aria-label="Về danh sách phòng">
          ←
        </Link>
        {room.type === 'dm' ? <Avatar name={room.name} /> : <span className="room-hash room-hash--lg">#</span>}
        <div className="room-title">
          <h1>{room.name}</h1>
          <p className="muted small">
            {room.type === 'dm'
              ? (room.peer?.email ?? 'Tin nhắn riêng')
              : [room.description, `${room.memberCount} thành viên`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {room.type === 'channel' && (
          <button type="button" className="btn-secondary" disabled={leave.isPending} onClick={() => leave.mutate(room.id)}>
            {leave.isPending ? 'Đang rời…' : 'Rời kênh'}
          </button>
        )}
      </header>
      {leave.error && <FormAlert>{describeChatError(leave.error)}</FormAlert>}
      <MessageList
        messages={messages.data}
        isPending={messages.isPending}
        error={messages.error}
        currentUserId={user?.id ?? ''}
        onRetry={retry}
      />
      <Composer
        placeholder={room.type === 'dm' ? `Nhắn cho ${room.name}` : `Nhắn vào #${room.name}`}
        onSend={send}
        disabled={!messages.isSuccess}
      />
    </>
  )
}

export function RoomView({ roomId }: { roomId: string }) {
  const rooms = useRooms()
  const room = rooms.data?.find((r) => r.id === roomId)

  if (rooms.isPending) return <p className="muted center">Đang tải…</p>
  if (!room) {
    return (
      <div className="room-empty">
        <h2>Không tìm thấy phòng</h2>
        <p className="muted">Phòng không tồn tại hoặc bạn không có quyền truy cập.</p>
        <Link to="/">Về trang chính</Link>
      </div>
    )
  }
  if (room.type === 'channel' && !room.joined) return <JoinPrompt room={room} />
  // key: đổi phòng thì reset ô soạn tin và trạng thái cuộn.
  return <Conversation key={room.id} room={room} />
}
