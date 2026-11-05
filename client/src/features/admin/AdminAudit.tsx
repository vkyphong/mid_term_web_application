import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Avatar } from '../chat/components/Avatar'
import { adminApi, type AuditEntry } from './adminApi'
import { describeError } from './adminErrors'

const ACTIONS: Record<string, { label: string; tone?: 'danger' | 'success' }> = {
  'user.kick': { label: 'Kick kết nối' },
  'user.ban': { label: 'Khóa tài khoản', tone: 'danger' },
  'user.unban': { label: 'Mở khóa tài khoản', tone: 'success' },
  'user.grant_admin': { label: 'Cấp quyền admin' },
  'user.revoke_admin': { label: 'Thu quyền admin', tone: 'danger' },
  broadcast: { label: 'Gửi broadcast' },
  'group.create': { label: 'Tạo nhóm', tone: 'success' },
  'group.rename': { label: 'Đổi tên nhóm' },
  'group.describe': { label: 'Sửa mô tả nhóm' },
  'group.member_add': { label: 'Thêm thành viên', tone: 'success' },
  'group.member_remove': { label: 'Xoá thành viên', tone: 'danger' },
  'group.member_role': { label: 'Đổi vai trò' },
  'group.approval_on': { label: 'Bật phê duyệt' },
  'group.approval_off': { label: 'Tắt phê duyệt' },
  'group.archive': { label: 'Lưu trữ nhóm', tone: 'danger' },
  'group.restore': { label: 'Khôi phục nhóm', tone: 'success' },
}
const ROLE: Record<string, string> = { owner: 'trưởng nhóm', deputy: 'phó nhóm', member: 'thành viên' }

function detailOf(e: AuditEntry): string {
  if (!e.detail) return ''
  if (e.action === 'broadcast') {
    const [count, ...rest] = e.detail.split(' | ')
    return `${count} tài khoản: “${rest.join(' | ')}”`
  }
  if (e.action === 'group.member_role') return e.detail.replace(/\b(owner|deputy|member)\b/g, (r) => ROLE[r])
  return e.detail
}

const formatTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'medium' })

/** Nhật ký quản trị: ai đã làm gì, với tài khoản / nhóm nào, lúc nào. */
export function AdminAudit({ enabled }: { enabled: boolean }) {
  const [page, setPage] = useState(0)
  const log = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => adminApi.audit(page),
    enabled,
    retry: false,
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  })
  const total = log.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / (log.data?.pageSize ?? 20)))

  return (
    <section className="admin-panel admin-audit" id="audit" aria-labelledby="audit-title">
      <div className="admin-panel-heading">
        <div>
          <h2 id="audit-title">Nhật ký quản trị <span className="admin-count">{log.data?.total ?? '—'}</span></h2>
          <p>Mọi thao tác của admin: tài khoản, nhóm và broadcast. Mới nhất ở trên.</p>
        </div>
      </div>
      {log.error && <p className="admin-inline-error" role="alert">{describeError(log.error)} <button onClick={() => void log.refetch()}>Thử lại</button></p>}
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
          <tbody>
            {log.isPending && enabled && <tr><td colSpan={5} className="admin-empty">Đang tải nhật ký…</td></tr>}
            {log.isSuccess && log.data.entries.length === 0 && <tr><td colSpan={5} className="admin-empty">Chưa có thao tác quản trị nào.</td></tr>}
            {log.data?.entries.map((e) => {
              const action = ACTIONS[e.action] ?? { label: e.action }
              return (
                <tr key={e.id}>
                  <td className="admin-audit-time">{formatTime(e.at)}</td>
                  <td>
                    <div className="admin-user-cell">
                      <Avatar name={e.actor.displayName} userId={e.actor.id} size="sm" />
                      <div><strong>{e.actor.displayName}</strong><span>{e.actor.email}</span></div>
                    </div>
                  </td>
                  <td><span className={`admin-audit-action${action.tone ? ` admin-audit-action--${action.tone}` : ''}`}>{action.label}</span></td>
                  <td>{e.targetType === 'system' ? 'Toàn hệ thống' : <>{e.targetType === 'group' ? '# ' : ''}{e.targetLabel ?? '—'}</>}</td>
                  <td className="admin-audit-detail" title={detailOf(e)}>{detailOf(e) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-pagination">
        <span>{log.data ? `${total} thao tác · Trang ${page + 1}/${pages}` : '—'}</span>
        <div>
          <button className="admin-button admin-button--small" disabled={page === 0 || log.isFetching} onClick={() => setPage((p) => p - 1)}>Trước</button>
          <button className="admin-button admin-button--small" disabled={page + 1 >= pages || log.isFetching} onClick={() => setPage((p) => p + 1)}>Sau</button>
        </div>
      </div>
      <p className="admin-footnote">Nhật ký chỉ ghi khi thao tác thật sự làm thay đổi dữ liệu và không thể sửa hay xoá từ dashboard.</p>
    </section>
  )
}
