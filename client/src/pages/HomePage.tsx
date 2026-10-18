import { useNavigate } from 'react-router-dom'
import { config } from '../config'
import { useLogout, useSession } from '../features/auth/hooks'

/** Trang tạm sau khi đăng nhập; giao diện chat sẽ thay thế ở F03. */
export function HomePage() {
  const navigate = useNavigate()
  const { user, session } = useSession()
  const logout = useLogout()

  if (!user || !session) return null

  const onLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })
  }

  return (
    <main className="home-page">
      <header className="home-header">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          {config.appName}
        </div>
        <button type="button" className="btn-secondary" onClick={onLogout} disabled={logout.isPending}>
          {logout.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
        </button>
      </header>

      <section className="home-card">
        <h1>Xin chào, {user.displayName}</h1>
        <dl className="session-info">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Vai trò</dt>
          <dd>{user.role}</dd>
          <dt>Access token hết hạn lúc</dt>
          <dd>{new Date(session.expiresAt).toLocaleTimeString('vi-VN')}</dd>
        </dl>
      </section>
    </main>
  )
}
