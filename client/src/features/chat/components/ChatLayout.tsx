import { Link, useNavigate, useParams } from 'react-router-dom'
import { config } from '../../../config'
import { useLogout, useSession } from '../../auth/hooks'
import { RealtimeStatus } from '../../realtime/RealtimeStatus'
import { NotificationBell, ToastHost } from './NotificationCenter'
import { useChatEvents } from '../hooks'
import '../chat.css'
import { Avatar } from './Avatar'
import { RoomView } from './RoomView'
import { Sidebar } from './Sidebar'

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
          <NotificationBell />
          <span className="chat-user">
            <Avatar name={user.displayName} size="sm" />
            <span className="chat-user-name">{user.displayName}</span>
          </span>
          <button type="button" className="btn-secondary" onClick={onLogout} disabled={logout.isPending}>
            {logout.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      </header>
      <ToastHost />
      <div className="chat-body">
        <Sidebar />
        <main className="chat-main">{roomId ? <RoomView roomId={roomId} /> : <Welcome name={user.displayName} />}</main>
      </div>
    </div>
  )
}
