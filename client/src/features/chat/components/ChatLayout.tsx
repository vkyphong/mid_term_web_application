import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { config } from '../../../config'
import { useLogout, useSession } from '../../auth/hooks'
import { RealtimeStatus } from '../../realtime/RealtimeStatus'
import { NotificationBell, ToastHost } from './NotificationCenter'
import { useChatEvents, useRooms } from '../hooks'
import { setSoundMuted, unlockSound, useSoundMuted } from '../sound'
import { countUnreadRooms } from '../unread'
import '../chat.css'
import { Avatar } from './Avatar'
import { ProfileAvatarDialog } from './ProfileAvatarDialog'
import { UserProfileHost } from './UserProfileDialog'
import { RoomView } from './RoomView'
import { Sidebar } from './Sidebar'

/** Bật/tắt âm báo tin nhắn mới (lưu theo trình duyệt). */
function SoundToggle() {
  const muted = useSoundMuted()
  return (
    <button
      type="button"
      className="icon-btn sound-toggle"
      aria-pressed={!muted}
      aria-label={muted ? 'Bật âm thanh thông báo' : 'Tắt âm thanh thông báo'}
      title={muted ? 'Bật âm thanh thông báo' : 'Tắt âm thanh thông báo'}
      onClick={() => {
        unlockSound()
        setSoundMuted(!muted)
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}

function Welcome({ name }: { name: string }) {
  return (
    <div className="room-empty">
      <h1>Xin chào, {name}</h1>
      <p className="muted">Chọn một kênh hoặc cuộc trò chuyện bên trái, hoặc duyệt kênh để tham gia.</p>
    </div>
  )
}

export function ChatLayout() {
  const navigate = useNavigate()
  const { roomId } = useParams()
  const { user } = useSession()
  const logout = useLogout()
  useChatEvents()
  const [profileOpen, setProfileOpen] = useState(false)
  const unreadRooms = countUnreadRooms(useRooms().data)
  // App chat cao đúng bằng màn hình và tự cuộn bên trong: khoá cuộn cấp trang để không bao giờ
  // trượt xuống khoảng trống bên dưới khi có phần tử tạm thời tràn ra ngoài.
  useEffect(() => {
    document.documentElement.classList.add('chat-page')
    return () => document.documentElement.classList.remove('chat-page')
  }, [])
  useEffect(() => {
    document.title = unreadRooms > 0 ? `(${unreadRooms}) ${config.appName}` : config.appName
    return () => {
      document.title = config.appName
    }
  }, [unreadRooms])

  if (!user) return null

  const onLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
  }

  return (
    <div className={`chat-app${roomId ? ' chat-app--room-open' : ''}`}>
      <header className="chat-header">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          {config.appName}
        </div>
        <div className="chat-header-right">
          <Link to="/lab">Protocol Lab</Link>
          {user.role === 'admin' && <Link to="/admin">Admin Dashboard</Link>}
          <RealtimeStatus />
          <SoundToggle />
          <NotificationBell />
          <span className="chat-user">
            <button type="button" className="chat-user-avatar" aria-label="Thông tin tài khoản" title="Thông tin tài khoản" onClick={() => setProfileOpen(true)}>
              <Avatar name={user.displayName} userId={user.id} size="sm" />
            </button>
            <span className="chat-user-name">{user.displayName}</span>
          </span>
          <button type="button" className="btn-secondary" onClick={onLogout} disabled={logout.isPending}>
            {logout.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      </header>
      <ToastHost />
      <UserProfileHost />
      {profileOpen && <ProfileAvatarDialog user={user} onClose={() => setProfileOpen(false)} />}
      <div className="chat-body">
        <Sidebar />
        <main className="chat-main">{roomId ? <RoomView roomId={roomId} /> : <Welcome name={user.displayName} />}</main>
      </div>
    </div>
  )
}
