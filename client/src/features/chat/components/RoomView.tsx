import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../auth/hooks'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import {
  useJoinRoom,
  useLeaveRoom,
  useJumpToMessage,
  useLoadOlder,
  useMessageActions,
  useMessages,
  useRoomMembers,
  useRooms,
  useSendMessage,
  type SendOptions,
} from '../hooks'
import { setActiveRoom } from '../notifications'
import { markViewed } from '../unread'
import { openProfile } from '../profileViewer'
import { onOutboxChange, outboxSize } from '../outbox'
import { useRealtimeStatus } from '../../realtime/RealtimeContext'
import { describePresence, usePresence } from '../presence'
import { describeTyping, useTypingSender, useTypingUsers } from '../typing'
import type { ChatMessage, Room, UserSummary } from '../types'
import { chatKeys } from '../hooks'
import { AddMembersDialog } from './AddMembersDialog'
import { RoomAvatar } from './RoomAvatar'
import { NicknameDialog, RenameGroupDialog } from './RoomSettingsDialogs'
import { GroupInfoDialog } from './GroupInfoDialog'
import { MembersDialog } from './MembersDialog'
import { MessageSearchBar } from './MessageSearchBar'
import { CreatePollDialog } from './Polls'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import '../../whiteboard/whiteboard.css'

const Whiteboard = lazy(() => import('../../whiteboard/Whiteboard').then((module) => ({ default: module.Whiteboard })))

function JoinPrompt({ room }: { room: Room }) {
  const join = useJoinRoom()
  return (
    <div className="room-empty">
      <h2># {room.name}</h2>
      {room.description && <p className="muted">{room.description}</p>}
      <p className="muted">{room.memberCount} thành viên · Bạn chưa tham gia kênh này.</p>
      {join.error && <FormAlert>{describeChatError(join.error)}</FormAlert>}
      {room.archived ? (
        <p className="archived-notice">Kênh đã được lưu trữ nên không thể tham gia.</p>
      ) : (
        <button type="button" className="btn-primary btn-inline" disabled={join.isPending} onClick={() => join.mutate(room.id)}>
          {join.isPending ? 'Đang tham gia…' : 'Tham gia kênh'}
        </button>
      )}
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

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
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
  const [panel, setPanel] = useState<'chat' | 'whiteboard'>('chat')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<'name' | 'nickname' | 'info' | 'members' | 'search' | 'poll' | null>(null)
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null)
  const [jumpError, setJumpError] = useState<string>()
  const closeEditing = () => setEditing(null)
  const canAddMembers = room.type === 'channel' && !room.archived
  const { user } = useSession()
  const messages = useMessages(room.id, true)
  const older = useLoadOlder(room.id)
  const { send, retry } = useSendMessage(room.id)
  const typing = useTypingSender(room.id)
  const presence = usePresence()
  const leave = useLeaveRoom()
  const members = useRoomMembers(room.id)
  const actions = useMessageActions()
  const jumpTo = useJumpToMessage(room.id)
  const peerPresence = presence.get(room.peer?.id)

  // Kết quả tìm kiếm → tải dần lịch sử tới tin đó, cuộn tới và tô sáng vài giây.
  const openSearchResult = async (messageId: string) => {
    setEditing(null)
    setPanel('chat')
    setJumpError(undefined)
    try {
      if (!(await jumpTo(messageId))) return setJumpError('Không tìm thấy tin trong lịch sử (có thể đã bị xoá).')
      setFocusMessageId(messageId)
    } catch (err) {
      setJumpError(describeChatError(err))
    }
  }
  useEffect(() => {
    if (!focusMessageId) return
    const timer = setTimeout(() => setFocusMessageId(null), 4_000)
    return () => clearTimeout(timer)
  }, [focusMessageId])

  // F09: đang xem phòng này thì không bật toast cho thông báo của chính phòng này.
  useEffect(() => {
    setActiveRoom(panel === 'chat' ? room.id : null)
    return () => setActiveRoom(null)
  }, [room.id, panel])

  // Đang xem (tab hiển thị) thì số tin chưa đọc về 0, kể cả khi danh sách phòng vừa tải lại từ server
  // trước khi receipts "đã xem" kịp gửi lên.
  const queryClient = useQueryClient()
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible')
  useEffect(() => {
    if (panel === 'chat' && visible) markViewed(queryClient, room.id, room.lastMessageAt)
  }, [queryClient, room.id, room.lastMessageAt, room.unreadCount, panel, visible])

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
          <button
            type="button"
            className="avatar-btn"
            aria-label={`Xem thông tin ${room.peer?.displayName ?? room.name}`}
            onClick={() => room.peer && openProfile(room.peer.id)}
          >
            <RoomAvatar room={room} online={peerPresence?.online ?? false} />
          </button>
        ) : canAddMembers ? (
          <button type="button" className="room-avatar-btn" aria-label="Thông tin nhóm" title="Thông tin nhóm" onClick={() => setEditing('info')}>
            <RoomAvatar room={room} />
          </button>
        ) : (
          <button type="button" className="room-avatar-btn" aria-label="Thông tin nhóm" title="Thông tin nhóm" onClick={() => setEditing('info')}>
            <RoomAvatar room={room} />
          </button>
        )}
        <div className="room-title">
          <div className="room-title-row">
            <h1>
              {room.name}
              {room.archived && <span className="archived-badge">Đã lưu trữ</span>}
            </h1>
            {(room.type === 'dm' || canAddMembers) && (
              <button
                type="button"
                className="icon-btn room-rename"
                aria-label={room.type === 'dm' ? 'Đổi biệt danh' : 'Đổi tên nhóm'}
                title={room.type === 'dm' ? 'Đổi biệt danh' : 'Đổi tên nhóm'}
                onClick={() => setEditing(room.type === 'dm' ? 'nickname' : 'name')}
              >
                ✏️
              </button>
            )}
          </div>
          <p className="muted small">
            {room.type === 'dm'
              ? [room.nickname && room.peer ? `Tên thật: ${room.peer.displayName}` : null, describePresence(peerPresence)]
                  .filter(Boolean)
                  .join(' · ')
              : (
                <>
                  {room.description && `${room.description} · `}
                  <button type="button" className="link-btn room-members-link" title="Xem thành viên và phân quyền" onClick={() => setEditing('members')}>
                    {room.memberCount} thành viên
                  </button>
                  {(room.pendingRequests ?? 0) > 0 && (
                    <button type="button" className="link-btn pending-badge" onClick={() => setEditing('members')}>
                      · {room.pendingRequests} chờ duyệt
                    </button>
                  )}
                </>
              )}
          </p>
        </div>
        <MessageSearchBar
          roomId={room.id}
          open={editing === 'search'}
          onOpen={() => setEditing('search')}
          onClose={closeEditing}
          onPick={(m) => void openSearchResult(m.id)}
        />
        {canAddMembers && (
          <button type="button" className="btn-secondary room-add-members" onClick={() => setAdding(true)}>
            Thêm thành viên
          </button>
        )}
        {room.type === 'channel' && (
          <button type="button" className="btn-secondary" disabled={leave.isPending} onClick={() => leave.mutate(room.id)}>
            {leave.isPending ? 'Đang rời…' : 'Rời kênh'}
          </button>
        )}
      </header>
      {leave.error && <FormAlert>{describeChatError(leave.error)}</FormAlert>}
      {adding && <AddMembersDialog room={room} onClose={() => setAdding(false)} />}
      {editing === 'name' && <RenameGroupDialog room={room} onClose={closeEditing} />}
      {editing === 'nickname' && <NicknameDialog room={room} onClose={closeEditing} />}
      {editing === 'info' && (
        <GroupInfoDialog
          room={room}
          onClose={closeEditing}
          onRename={() => setEditing('name')}
          onManage={() => setEditing('members')}
          onLeave={() => {
            setEditing(null)
            leave.mutate(room.id)
          }}
        />
      )}
      {editing === 'members' && (
        <MembersDialog
          room={room}
          selfId={user?.id ?? ''}
          onClose={closeEditing}
          onAddMembers={canAddMembers ? () => { setEditing(null); setAdding(true) } : undefined}
        />
      )}
      {editing === 'poll' && <CreatePollDialog roomId={room.id} onClose={closeEditing} />}
      {jumpError && <FormAlert>{jumpError}</FormAlert>}
      <div className="room-tabs" role="tablist" aria-label="Nội dung phòng">
        <button type="button" role="tab" id="room-chat-tab" aria-controls="room-chat-panel" aria-selected={panel === 'chat'} onClick={() => setPanel('chat')}>Trò chuyện</button>
        <button type="button" role="tab" id="room-whiteboard-tab" aria-controls="room-whiteboard-panel" aria-selected={panel === 'whiteboard'} onClick={() => { typing.onSent(); setPanel('whiteboard') }}>Bảng trắng</button>
      </div>
      {panel === 'whiteboard' ? <div className="whiteboard-panel" id="room-whiteboard-panel" role="tabpanel" aria-labelledby="room-whiteboard-tab"><Suspense fallback={<p className="whiteboard-empty">Đang tải bảng trắng…</p>}><Whiteboard key={room.id} roomId={room.id} /></Suspense></div> : <div className="conversation-panel" id="room-chat-panel" role="tabpanel" aria-labelledby="room-chat-tab">
      <MessageList
        messages={messages.data}
        isPending={messages.isPending}
        error={messages.error}
        currentUserId={user?.id ?? ''}
        onRetry={retry}
        roomType={room.type}
        members={members.data}
        actions={actions}
        focusMessageId={focusMessageId}
        onOpenMessage={(id) => void openSearchResult(id)}
        history={{
          hasMore: older.hasMore,
          isLoading: older.isLoading,
          error: older.error,
          onLoadOlder: older.loadOlder,
        }}
      />
      <TypingIndicator room={room} messages={messages.data} selfId={user?.id} />
      <ConnectionBanner />
      {room.archived ? (
        <p className="archived-notice composer-archived" role="status">
          Nhóm đã được lưu trữ. Bạn vẫn xem được lịch sử nhưng không thể gửi tin, gửi tệp hay thêm thành viên.
        </p>
      ) : (
        <Composer
          roomId={room.id}
          members={members.data}
          selfId={user?.id}
          placeholder={room.type === 'dm' ? `Nhập tin nhắn tới ${room.name}` : `Nhập @, tin nhắn tới #${room.name}`}
          onSend={onSend}
          onInput={typing.onInput}
          allowMentionAll={room.type === 'channel'}
          onAddMembers={canAddMembers ? () => setAdding(true) : undefined}
          onCreatePoll={canAddMembers ? () => setEditing('poll') : undefined}
          // Chỉ khoá khi lịch sử chưa từng tải xong (để chèn bản tạm); tải lại lỗi lúc offline vẫn cho gõ (F10).
          disabled={messages.data === undefined}
        />
      )}
      </div>}
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
