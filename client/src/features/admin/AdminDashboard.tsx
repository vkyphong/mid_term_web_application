import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { config } from '../../config'
import { ApiError } from '../../lib/apiError'
import { describeError } from './adminErrors'
import { AdminGroups } from './AdminGroups'
import { Confirmation, Icon } from './adminUi'
import { useLogout, useSession } from '../auth/hooks'
import { adminApi, type AdminUser } from './adminApi'
import { useAdminStats, type StatsSample } from './useAdminStats'

type AccountAction = 'kick' | 'ban' | 'unban' | 'grant' | 'revoke'

/** Nội dung hộp xác nhận và thông báo cho từng thao tác với tài khoản. */
const ACCOUNT_ACTIONS: Record<AccountAction, { title: string; body: string; confirm: string; danger: boolean; done: (email: string) => string }> = {
  kick: {
    title: 'Ngắt kết nối người dùng?', confirm: 'Xác nhận Kick', danger: false,
    body: 'Đóng tất cả kết nối chat và Lab hiện tại. Người dùng vẫn có thể đăng nhập và kết nối lại.',
    done: (email) => `Đã ngắt các kết nối hiện tại của ${email}. Người dùng có thể kết nối lại.`,
  },
  ban: {
    title: 'Khóa tài khoản này?', confirm: 'Xác nhận Ban', danger: true,
    body: 'Tài khoản sẽ bị khóa, mọi phiên đăng nhập bị thu hồi và các kết nối bị đóng. Có thể mở khóa lại sau.',
    done: (email) => `Đã khóa tài khoản ${email}.`,
  },
  unban: {
    title: 'Mở khóa tài khoản này?', confirm: 'Xác nhận mở khóa', danger: false,
    body: 'Người dùng đăng nhập lại được ngay. Các phiên cũ đã bị thu hồi khi khóa nên họ cần đăng nhập mới.',
    done: (email) => `Đã mở khóa tài khoản ${email}.`,
  },
  grant: {
    title: 'Cấp quyền admin?', confirm: 'Xác nhận cấp quyền', danger: false,
    body: 'Tài khoản sẽ truy cập được Admin Dashboard: kick/ban, broadcast, quản lý nhóm và cấp quyền cho người khác. Người dùng cần đăng nhập lại để thấy dashboard.',
    done: (email) => `Đã cấp quyền admin cho ${email}.`,
  },
  revoke: {
    title: 'Thu hồi quyền admin?', confirm: 'Xác nhận thu hồi', danger: true,
    body: 'Tài khoản trở về nhân viên thường, mất quyền truy cập dashboard ngay và các kết nối hiện tại bị đóng.',
    done: (email) => `Đã thu hồi quyền admin của ${email}.`,
  },
}

function runAccountAction(id: string, action: AccountAction) {
  if (action === 'unban') return adminApi.unban(id)
  if (action === 'grant') return adminApi.setRole(id, 'admin')
  if (action === 'revoke') return adminApi.setRole(id, 'user')
  return adminApi.moderate(id, action)
}
import './admin.css'

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
  const [selection, setSelection] = useState<{ user: AdminUser; action: AccountAction } | null>(null)
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
    mutationFn: ({ user: target, action }: NonNullable<typeof selection>) => runAccountAction(target.id, action),
    onSuccess: (_result, { user: target, action }) => {
      setNotice(ACCOUNT_ACTIONS[action].done(target.email))
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
  const choose = (target: AdminUser, action: AccountAction) => { moderation.reset(); setSelection({ user: target, action }) }
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
        <nav aria-label="Quản trị"><a href="#overview" className="admin-nav-active"><Icon name="pulse" />Live Dashboard</a><a href="#accounts"><Icon name="users" />Tài khoản</a><a href="#groups"><Icon name="channel" />Nhóm</a><a href="#broadcast"><Icon name="broadcast" />Broadcast</a><Link to="/lab"><Icon name="pulse" />Protocol Lab</Link></nav>
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
                <div className="admin-panel-heading"><div><h2 id="accounts-title">Quản lý tài khoản <span className="admin-count">{users.data?.total ?? '—'}</span></h2><p>Kick kết nối, khóa / mở khóa tài khoản và cấp quyền admin.</p></div></div>
                <label className="admin-search"><span className="sr-only">Tìm tài khoản</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input type="search" placeholder="Tìm theo tên hoặc email…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
                {users.error && <p className="admin-inline-error" role="alert">{describeError(users.error)} <button onClick={() => void users.refetch()}>Thử lại</button></p>}
                <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
                  {users.isPending && <tr><td colSpan={3} className="admin-empty">Đang tải tài khoản…</td></tr>}
                  {users.isSuccess && users.data.users.length === 0 && <tr><td colSpan={3} className="admin-empty">Không tìm thấy tài khoản phù hợp.</td></tr>}
                  {users.data?.users.map((target) => <tr key={target.id}><td><div className="admin-user-cell"><span className="admin-avatar">{target.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{target.displayName} {target.id === user?.id && <small>(Bạn)</small>}</strong><span>{target.email}</span>{target.role === 'admin' && <small className="admin-user-role">Admin</small>}</div></div></td><td><span className={`admin-user-state ${!target.enabled ? 'admin-user-state--banned' : target.online ? 'admin-user-state--online' : ''}`}><i />{!target.enabled ? 'Đã khóa' : target.online ? 'Online' : 'Offline'}</span></td><td><div className="admin-actions"><button type="button" className="admin-button admin-button--small" disabled={!enabled || !target.enabled || !target.online || target.id === user?.id || moderation.isPending} onClick={() => choose(target, 'kick')} aria-label={`Kick ${target.email}`}>Kick</button>{target.enabled ? <button type="button" className="admin-button admin-button--small admin-button--danger" disabled={!enabled || target.id === user?.id || moderation.isPending} onClick={() => choose(target, 'ban')} aria-label={`Ban ${target.email}`}>Ban</button> : <button type="button" className="admin-button admin-button--small admin-button--success" disabled={!enabled || moderation.isPending} onClick={() => choose(target, 'unban')} aria-label={`Mở khóa ${target.email}`}>Mở khóa</button>}<button type="button" className="admin-button admin-button--small" disabled={!enabled || target.id === user?.id || moderation.isPending} onClick={() => choose(target, target.role === 'admin' ? 'revoke' : 'grant')} aria-label={`${target.role === 'admin' ? 'Thu quyền admin' : 'Cấp quyền admin'} ${target.email}`}>{target.role === 'admin' ? 'Thu quyền admin' : 'Cấp admin'}</button></div></td></tr>)}
                </tbody></table></div>
                <div className="admin-pagination"><span>{users.data ? `${users.data.total} tài khoản · Trang ${page + 1}/${Math.max(1, Math.ceil(users.data.total / users.data.pageSize))}` : '—'}</span><div><button className="admin-button admin-button--small" disabled={page === 0 || users.isFetching} onClick={() => setPage((p) => p - 1)}>Trước</button><button className="admin-button admin-button--small" disabled={!users.data || (page + 1) * users.data.pageSize >= users.data.total || users.isFetching} onClick={() => setPage((p) => p + 1)}>Sau</button></div></div>
                <p className="admin-footnote">Danh sách cập nhật mỗi 5 giây. Kick cho phép kết nối lại; Ban khóa tài khoản và thu hồi các phiên đăng nhập, Mở khóa cho đăng nhập lại. Không tự Ban hoặc tự đổi quyền của chính mình.</p>
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
            <AdminGroups enabled={enabled} onNotice={setNotice} />
            <footer className="admin-footer"><span><Icon name="shield" />Chỉ dành cho IT Admin</span><span>{config.appName} · Live Operations</span></footer>
          </>}
        </div>
      </main>

      {selection && <Confirmation title={ACCOUNT_ACTIONS[selection.action].title} busy={moderation.isPending} onClose={() => setSelection(null)}><p><strong>{selection.user.displayName}</strong><br />{selection.user.email}</p><p>{ACCOUNT_ACTIONS[selection.action].body}</p>{moderation.error && <p className="admin-inline-error" role="alert">{describeError(moderation.error)}</p>}<div className="admin-dialog-actions"><button className="admin-button" autoFocus disabled={moderation.isPending} onClick={() => setSelection(null)}>Hủy</button><button className={`admin-button ${ACCOUNT_ACTIONS[selection.action].danger ? 'admin-button--danger-fill' : 'admin-button--primary'}`} disabled={moderation.isPending} onClick={() => moderation.mutate(selection)}>{moderation.isPending ? 'Đang xử lý…' : ACCOUNT_ACTIONS[selection.action].confirm}</button></div></Confirmation>}
      {confirmBroadcast && <Confirmation title="Gửi thông báo toàn hệ thống?" busy={broadcast.isPending} onClose={() => setConfirmBroadcast(false)}><p>Thông báo sẽ được lưu cho mọi tài khoản đang được kích hoạt.</p><blockquote className="admin-broadcast-preview">{content.trim()}</blockquote>{broadcast.error && <p className="admin-inline-error" role="alert">{describeError(broadcast.error)} Kiểm tra thông báo đã gửi trước khi thử lại nếu kết nối bị gián đoạn.</p>}<div className="admin-dialog-actions"><button className="admin-button" autoFocus disabled={broadcast.isPending} onClick={() => setConfirmBroadcast(false)}>Hủy</button><button className="admin-button admin-button--primary" disabled={broadcast.isPending} onClick={() => broadcast.mutate(content.trim())}>{broadcast.isPending ? 'Đang gửi…' : 'Xác nhận gửi'}</button></div></Confirmation>}
    </div>
  )
}
