import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { config } from '../../config'
import { ApiError } from '../../lib/apiError'
import { useLogout, useSession } from '../auth/hooks'
import { adminApi, type AdminUser } from './adminApi'
import { useAdminStats, type StatsSample } from './useAdminStats'
import './admin.css'

function describeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Tài khoản không có quyền quản trị. Vui lòng đăng nhập lại sau khi được cấp quyền.'
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.code === 'network_error') return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
    if (error.details.length) return error.details[0].message
  }
  return 'Chưa thực hiện được thao tác. Vui lòng thử lại.'
}

function Icon({ name }: { name: 'pulse' | 'users' | 'message' | 'channel' | 'shield' | 'broadcast' }) {
  const paths = {
    pulse: 'M3 12h4l3-8 4 16 3-8h4',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    message: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
    channel: 'M4 9h16M3 15h16M10 3 8 21M16 3l-2 18',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11ZM9 12l2 2 4-4',
    broadcast: 'M3 10v4h4l12 5V5L7 10H3ZM7 14l2 7h4l-2-5M22 9v6',
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function Confirmation({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])
  return (
    <dialog ref={ref} className="admin-dialog" aria-labelledby="admin-confirm-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <div className="admin-dialog-icon"><Icon name="shield" /></div>
      <h2 id="admin-confirm-title">{title}</h2>
      {children}
    </dialog>
  )
}

function TrafficChart({ samples, live }: { samples: StatsSample[]; live: boolean }) {
  const latest = samples.at(-1)?.at ?? Date.now()
  const recent = samples.filter((s) => s.at >= latest - 60_000)
  const max = Math.max(4, ...recent.map((s) => s.msgPerSec))
  const groups: StatsSample[][] = []
  recent.forEach((s, i) => {
    if (i === 0 || s.at - recent[i - 1].at > 4000) groups.push([])
    groups[groups.length - 1].push(s)
  })
  return (
    <div className="admin-chart" role="img" aria-label={`Biểu đồ tin nhắn mỗi giây, ${recent.length} mẫu trong 60 giây. ${live ? 'Đang cập nhật trực tiếp.' : 'Đang chờ dữ liệu trực tiếp.'}`}>
      <div className="admin-chart-scale"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
      <div className="admin-chart-plot">
        <svg viewBox="0 0 720 160" preserveAspectRatio="none" aria-hidden="true">
          {[8, 80, 152].map((y) => <line key={y} x1="0" x2="720" y1={y} y2={y} className="admin-chart-grid" />)}
          {groups.map((group, i) => <polyline key={i} points={group.map((s) => `${720 * (s.at - (latest - 60_000)) / 60_000},${152 - s.msgPerSec / max * 144}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />)}
        </svg>
        {recent.length < 2 && <span className="admin-chart-wait">Đang chờ các mẫu thống kê trực tiếp…</span>}
        <div className="admin-chart-axis"><span>60 giây trước</span><span>30 giây</span><span>Mẫu mới nhất</span></div>
      </div>
    </div>
  )
}

export function AdminDashboard() {
  const { user } = useSession()
  const navigate = useNavigate()
  const logout = useLogout()
  const queryClient = useQueryClient()
  const stats = useAdminStats()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [selection, setSelection] = useState<{ user: AdminUser; action: 'kick' | 'ban' } | null>(null)
  const [content, setContent] = useState('')
  const [confirmBroadcast, setConfirmBroadcast] = useState(false)
  const [notice, setNotice] = useState('')
  const forbidden = stats.error instanceof ApiError && stats.error.status === 403
  const enabled = !forbidden && !config.useMockApi
  const users = useQuery({ queryKey: ['admin', 'users', filter, page], queryFn: () => adminApi.users(filter, page), enabled, retry: false, refetchInterval: 5000 })
  const channels = useQuery({ queryKey: ['admin', 'channels'], queryFn: adminApi.channels, enabled, retry: false, refetchInterval: 5000 })

  useEffect(() => {
    const timer = setTimeout(() => { setFilter(search.trim()); setPage(0) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const moderation = useMutation({
    mutationFn: ({ user: target, action }: NonNullable<typeof selection>) => adminApi.moderate(target.id, action),
    onSuccess: (_result, { user: target, action }) => {
      setNotice(action === 'ban' ? `Đã khóa tài khoản ${target.email}.` : `Đã ngắt các kết nối hiện tại của ${target.email}. Người dùng có thể kết nối lại.`)
      setSelection(null)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  const broadcast = useMutation({
    mutationFn: adminApi.broadcast,
    onSuccess: ({ recipients }) => {
      setNotice(`Đã gửi thông báo đến ${recipients} tài khoản, bao gồm người đang offline.`)
      setContent('')
      setConfirmBroadcast(false)
    },
  })
  const bytes = new TextEncoder().encode(content.trim()).length
  const choose = (target: AdminUser, action: 'kick' | 'ban') => { moderation.reset(); setSelection({ user: target, action }) }
  const submitBroadcast = (e: FormEvent) => {
    e.preventDefault()
    if (bytes < 1 || bytes > 2048 || broadcast.isPending || !enabled) return
    broadcast.reset()
    setConfirmBroadcast(true)
  }
  const number = (n: number | undefined) => n === undefined ? '—' : n.toLocaleString('vi-VN')

  return (
    <div className="admin-app">
      <aside className="admin-sidebar">
        <Link className="brand" to="/"><span className="brand-dot" aria-hidden="true" />{config.appName}</Link>
        <div className="admin-workspace"><span className="admin-workspace-icon"><Icon name="shield" /></span><div><strong>IT Administration</strong><span>Không gian quản trị</span></div></div>
        <p className="admin-nav-label">ĐIỀU HÀNH</p>
        <nav aria-label="Quản trị"><a href="#overview" className="admin-nav-active"><Icon name="pulse" />Live Dashboard</a><a href="#accounts"><Icon name="users" />Tài khoản</a><a href="#broadcast"><Icon name="broadcast" />Broadcast</a><Link to="/lab"><Icon name="pulse" />Protocol Lab</Link></nav>
      </aside>

      <main className="admin-main" id="overview">
        <header className="admin-topbar">
          <span className="admin-breadcrumb">Quản trị <span aria-hidden="true">/</span> <strong>Live Dashboard</strong></span>
          <div className="admin-header-right">
            <Link className="admin-button" to="/lab">Protocol Lab</Link>
            <Link className="admin-button admin-chat-link" to="/" title="Về ứng dụng chat" aria-label="Về ứng dụng chat"><Icon name="message" /></Link>
            <div className="admin-account">
              <span className="admin-avatar" aria-hidden="true">{user?.displayName.slice(0, 1).toUpperCase()}</span>
              <div className="admin-account-info"><strong>{user?.displayName}</strong><span>IT Admin</span></div>
            </div>
            <button className="admin-button" type="button" disabled={logout.isPending} onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) })}>
              {logout.isPending ? 'Đang đăng xuất…' : 'Đăng xuất'}
            </button>
          </div>
        </header>
        <div className="admin-content">
          <div className="admin-page-heading"><div><p className="admin-eyebrow">{config.appName} · OPERATIONS</p><h1>Admin Live Dashboard</h1><p>Theo dõi hoạt động và điều hành hệ thống chat.</p></div><span className={`admin-live ${stats.fresh ? 'admin-live--on' : ''}`} role="status"><i />{stats.live ? 'Trực tiếp · mỗi giây' : stats.fresh ? 'Cập nhật qua REST' : 'Đang chờ kết nối'}</span></div>
          {config.useMockApi && <p className="admin-alert" role="alert">Dashboard cần backend thật. Tắt VITE_USE_MOCK_API để sử dụng các thao tác quản trị.</p>}
          {forbidden ? <p className="admin-alert" role="alert">{describeError(stats.error)}</p> : <>
            {stats.error && <p className="admin-alert" role="alert">{describeError(stats.error)} <button onClick={() => void stats.refetch()}>Thử lại</button></p>}
            {!stats.fresh && stats.data && <p className="admin-alert" role="status">Dữ liệu có thể đã cũ. Đang chờ cập nhật từ máy chủ; số liệu dưới đây là lần nhận cuối.</p>}
            {notice && <div className="admin-notice" role="status"><span>✓ {notice}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setNotice('')}>×</button></div>}

            <section className="admin-metrics" aria-label="Thống kê hệ thống">
              {([
                ['pulse', 'Kết nối hiện tại', stats.data?.connections, 'Socket chat đã xác thực'],
                ['users', 'Người dùng online', stats.data?.onlineUsers, 'Người dùng duy nhất'],
                ['message', 'Tin nhắn / giây', stats.data?.msgPerSec, 'Tin mới lưu trong giây trước'],
                ['channel', 'Phòng hoạt động', stats.data?.activeRooms, 'Kênh & DM có tin trong 60 giây'],
              ] as const).map(([icon, label, value, hint]) => <article className="admin-metric" key={label}><div className="admin-metric-top"><span>{label}</span><span className={`admin-metric-icon admin-metric-icon--${icon}`}><Icon name={icon} /></span></div><strong>{number(value)}</strong><p>{hint}</p></article>)}
            </section>

            <section className="admin-panel admin-traffic" aria-labelledby="traffic-title"><div className="admin-panel-heading"><div><h2 id="traffic-title">Lưu lượng tin nhắn</h2><p>Tin mới được lưu mỗi giây · cửa sổ 60 giây</p></div><span className="admin-chip">msg/s</span></div><TrafficChart samples={stats.history} live={stats.live} /><p className="admin-footnote">Số liệu của một backend, không bao gồm Protocol Lab. Biểu đồ bắt đầu khi mở dashboard; các khoảng mất kết nối được để trống.</p></section>

            <div className="admin-columns">
              <section className="admin-panel admin-accounts" id="accounts" aria-labelledby="accounts-title">
                <div className="admin-panel-heading"><div><h2 id="accounts-title">Quản lý tài khoản <span className="admin-count">{users.data?.total ?? '—'}</span></h2><p>Kick kết nối hoặc khóa quyền truy cập.</p></div></div>
                <label className="admin-search"><span className="sr-only">Tìm tài khoản</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" placeholder="Tìm theo tên hoặc email…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
                {users.error && <p className="admin-inline-error" role="alert">{describeError(users.error)} <button onClick={() => void users.refetch()}>Thử lại</button></p>}
                <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
                  {users.isPending && <tr><td colSpan={3} className="admin-empty">Đang tải tài khoản…</td></tr>}
                  {users.isSuccess && users.data.users.length === 0 && <tr><td colSpan={3} className="admin-empty">Không tìm thấy tài khoản phù hợp.</td></tr>}
                  {users.data?.users.map((target) => <tr key={target.id}><td><div className="admin-user-cell"><span className="admin-avatar">{target.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{target.displayName} {target.id === user?.id && <small>(Bạn)</small>}</strong><span>{target.email}</span>{target.role === 'admin' && <small className="admin-user-role">Admin</small>}</div></div></td><td><span className={`admin-user-state ${!target.enabled ? 'admin-user-state--banned' : target.online ? 'admin-user-state--online' : ''}`}><i />{!target.enabled ? 'Đã khóa' : target.online ? 'Online' : 'Offline'}</span></td><td><div className="admin-actions"><button type="button" className="admin-button admin-button--small" disabled={!enabled || !target.enabled || !target.online || target.id === user?.id || moderation.isPending} onClick={() => choose(target, 'kick')} aria-label={`Kick ${target.email}`}>Kick</button><button type="button" className="admin-button admin-button--small admin-button--danger" disabled={!enabled || !target.enabled || target.id === user?.id || moderation.isPending} onClick={() => choose(target, 'ban')} aria-label={`Ban ${target.email}`}>Ban</button></div></td></tr>)}
                </tbody></table></div>
                <div className="admin-pagination"><span>{users.data ? `${users.data.total} tài khoản · Trang ${page + 1}/${Math.max(1, Math.ceil(users.data.total / users.data.pageSize))}` : '—'}</span><div><button className="admin-button admin-button--small" disabled={page === 0 || users.isFetching} onClick={() => setPage((p) => p - 1)}>Trước</button><button className="admin-button admin-button--small" disabled={!users.data || (page + 1) * users.data.pageSize >= users.data.total || users.isFetching} onClick={() => setPage((p) => p + 1)}>Sau</button></div></div>
                <p className="admin-footnote">Danh sách cập nhật mỗi 5 giây. Kick cho phép kết nối lại; Ban khóa tài khoản và thu hồi các phiên đăng nhập.</p>
              </section>

              <div className="admin-right-column">
                <section className="admin-panel" aria-labelledby="channels-title"><div className="admin-panel-heading"><div><h2 id="channels-title">Kênh đang hoạt động</h2><p>Có tin mới trong 60 giây · cập nhật mỗi 5 giây</p></div><Icon name="channel" /></div>
                  {channels.error && <p className="admin-inline-error" role="alert">{describeError(channels.error)} <button onClick={() => void channels.refetch()}>Thử lại</button></p>}
                  {channels.isPending && <p className="admin-empty">Đang tải hoạt động kênh…</p>}
                  {channels.isSuccess && channels.data.channels.length === 0 && <div className="admin-empty"><Icon name="channel" /><p>Chưa có kênh hoạt động trong phút qua.</p></div>}
                  <ul className="admin-channel-list">{channels.data?.channels.map((channel) => <li key={channel.id}><span className="admin-channel-hash">#</span><div><strong>{channel.name}</strong><span>{channel.members} thành viên</span></div><span className="admin-channel-volume"><strong>{channel.messagesLastMinute}</strong> tin/phút</span></li>)}</ul>
                  {channels.data && channels.data.channels.length >= 50 && <p className="admin-footnote">Hiển thị 50 kênh có tin gần nhất.</p>}
                </section>

                <section className="admin-panel admin-broadcast" id="broadcast" aria-labelledby="broadcast-title"><div className="admin-panel-heading"><div><h2 id="broadcast-title"><Icon name="broadcast" />Broadcast hệ thống</h2><p>Gửi thông báo đến mọi tài khoản đang được kích hoạt, kể cả người offline.</p></div></div><form onSubmit={submitBroadcast}><label htmlFor="broadcast-content" className="sr-only">Nội dung broadcast</label><textarea id="broadcast-content" rows={4} placeholder="VD: Hệ thống bảo trì lúc 22:00 hôm nay…" value={content} onChange={(e) => setContent(e.target.value)} aria-invalid={bytes > 2048} disabled={broadcast.isPending || !enabled} /><div className="admin-broadcast-bottom"><span className={bytes > 2048 ? 'admin-text-danger' : ''}>{bytes}/2048 byte</span><button className="admin-button admin-button--primary" type="submit" disabled={!enabled || bytes < 1 || bytes > 2048 || broadcast.isPending}><Icon name="broadcast" />Gửi broadcast</button></div>{bytes > 2048 && <p className="admin-inline-error">Nội dung vượt giới hạn 2048 byte UTF-8.</p>}</form></section>
              </div>
            </div>
            <footer className="admin-footer"><span><Icon name="shield" />Chỉ dành cho IT Admin</span><span>{config.appName} · Live Operations</span></footer>
          </>}
        </div>
      </main>

      {selection && <Confirmation title={selection.action === 'ban' ? 'Khóa tài khoản này?' : 'Ngắt kết nối người dùng?'} busy={moderation.isPending} onClose={() => setSelection(null)}><p><strong>{selection.user.displayName}</strong><br />{selection.user.email}</p><p>{selection.action === 'ban' ? 'Tài khoản sẽ bị khóa, mọi phiên đăng nhập bị thu hồi và các kết nối bị đóng. Dashboard hiện chưa có thao tác mở khóa.' : 'Đóng tất cả kết nối chat và Lab hiện tại. Người dùng vẫn có thể đăng nhập và kết nối lại.'}</p>{moderation.error && <p className="admin-inline-error" role="alert">{describeError(moderation.error)}</p>}<div className="admin-dialog-actions"><button className="admin-button" autoFocus disabled={moderation.isPending} onClick={() => setSelection(null)}>Hủy</button><button className={`admin-button ${selection.action === 'ban' ? 'admin-button--danger-fill' : 'admin-button--primary'}`} disabled={moderation.isPending} onClick={() => moderation.mutate(selection)}>{moderation.isPending ? 'Đang xử lý…' : selection.action === 'ban' ? 'Xác nhận Ban' : 'Xác nhận Kick'}</button></div></Confirmation>}
      {confirmBroadcast && <Confirmation title="Gửi thông báo toàn hệ thống?" busy={broadcast.isPending} onClose={() => setConfirmBroadcast(false)}><p>Thông báo sẽ được lưu cho mọi tài khoản đang được kích hoạt.</p><blockquote className="admin-broadcast-preview">{content.trim()}</blockquote>{broadcast.error && <p className="admin-inline-error" role="alert">{describeError(broadcast.error)} Kiểm tra thông báo đã gửi trước khi thử lại nếu kết nối bị gián đoạn.</p>}<div className="admin-dialog-actions"><button className="admin-button" autoFocus disabled={broadcast.isPending} onClick={() => setConfirmBroadcast(false)}>Hủy</button><button className="admin-button admin-button--primary" disabled={broadcast.isPending} onClick={() => broadcast.mutate(content.trim())}>{broadcast.isPending ? 'Đang gửi…' : 'Xác nhận gửi'}</button></div></Confirmation>}
    </div>
  )
}
