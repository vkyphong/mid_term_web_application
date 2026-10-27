import { useEffect, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../auth/hooks'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import {
  useJoinRoom,
  useLeaveRoom,
  useLoadOlder,
  useMessageActions,
  useMessages,
  useRoomMembers,
  useRooms,
  useSendMessage,
  type SendOptions,
} from '../hooks'
import { setActiveRoom } from '../notifications'
import { onOutboxChange, outboxSize } from '../outbox'
import { useRealtimeStatus } from '../../realtime/RealtimeContext'
import { describePresence, usePresence } from '../presence'
import { describeTyping, useTypingSender, useTypingUsers } from '../typing'
import type { ChatMessage, Room, UserSummary } from '../types'
import { chatKeys } from '../hooks'
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

/** Tên hiển thị cho userId: người trong DM, người đã nhắn trong phòng, hoặc danh sách đồng nghiệp. */
function useDisplayName(room: Room, messages: ChatMessage[] | undefined) {
  const queryClient = useQueryClient()
  return (userId: string) =>
    (room.peer?.id === userId ? room.peer.displayName : undefined) ??
    messages?.find((m) => m.sender.id === userId)?.sender.displayName ??
    queryClient.getQueryData<UserSummary[]>(chatKeys.users(''))?.find((u) => u.id === userId)?.displayName ??
    'Ai đó'
}

function TypingIndicator({ room, messages, selfId }: { room: Room; messages: ChatMessage[] | undefined; selfId?: string }) {
  const typing = useTypingUsers(room.id, selfId)
  const nameOf = useDisplayName(room, messages)
  const text = describeTyping(typing.map(nameOf))
  return (
    <p className="typing-indicator" aria-live="polite">
      {text}
    </p>
  )
}

/** F10: báo mất kết nối và số tin đang chờ gửi bù. */
function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

function ConnectionBanner() {
  const { state } = useRealtimeStatus()
  const queued = useSyncExternalStore(onOutboxChange, outboxSize)
  const browserOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  if (browserOnline && (state === 'connected' || state === 'mock')) return null
  return (
    <p className="connection-banner" role="status">
      {state === 'connecting' ? 'Đang kết nối lại…' : 'Mất kết nối.'}{' '}
      {queued > 0
        ? `${queued} tin đang chờ, sẽ tự gửi khi có kết nối.`
        : 'Tin bạn gửi sẽ được xếp hàng và gửi khi có kết nối.'}
    </p>
  )
}

function Conversation({ room }: { room: Room }) {
  const { user } = useSession()
  const messages = useMessages(room.id, true)
  const older = useLoadOlder(room.id)
  const { send, retry } = useSendMessage(room.id)
  const typing = useTypingSender(room.id)
  const presence = usePresence()
  const leave = useLeaveRoom()
  const members = useRoomMembers(room.id)
  const actions = useMessageActions()
  const peerPresence = presence.get(room.peer?.id)

  // F09: đang xem phòng này thì không bật toast cho thông báo của chính phòng này.
  useEffect(() => {
    setActiveRoom(room.id)
    return () => setActiveRoom(null)
  }, [room.id])

  const onSend = (content: string, options: SendOptions) => {
    typing.onSent()
    send(content, options)
  }

  return (
    <>
      <header className="room-header">
        <Link to="/" className="back-link" aria-label="Về danh sách phòng">
          ←
        </Link>
        {room.type === 'dm' ? (
          <Avatar name={room.name} online={peerPresence?.online ?? false} />
        ) : (
          <span className="room-hash room-hash--lg">#</span>
        )}
        <div className="room-title">
          <h1>{room.name}</h1>
          <p className="muted small">
            {room.type === 'dm'
              ? [describePresence(peerPresence), room.peer?.email].filter(Boolean).join(' · ')
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
        roomType={room.type}
        members={members.data}
        actions={actions}
        history={{
          hasMore: older.hasMore,
          isLoading: older.isLoading,
          error: older.error,
          onLoadOlder: older.loadOlder,
        }}
      />
      <TypingIndicator room={room} messages={messages.data} selfId={user?.id} />
      <ConnectionBanner />
      <Composer
        roomId={room.id}
        members={members.data}
        selfId={user?.id}
        placeholder={room.type === 'dm' ? `Nhắn cho ${room.name}` : `Nhắn vào #${room.name}`}
        onSend={onSend}
        onInput={typing.onInput}
        // Chỉ khoá khi lịch sử chưa từng tải xong (để chèn bản tạm); tải lại lỗi lúc offline vẫn cho gõ (F10).
        disabled={messages.data === undefined}
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
