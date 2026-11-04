import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/apiError'
import { adminApi, type AdminGroup, type GroupMember, type GroupRole } from './adminApi'
import { describeError } from './adminErrors'
import { Confirmation } from './adminUi'
import { Avatar } from '../chat/components/Avatar'

type Status = 'all' | 'active' | 'archived'
const ROLE_LABEL: Record<GroupRole, string> = { owner: 'Trưởng nhóm', deputy: 'Phó nhóm', member: 'Thành viên' }
const MAX_DEPUTIES = 5

function groupError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.reason === 'room_name_taken') return 'Tên nhóm đã tồn tại. Hãy chọn tên khác.'
    if (error.reason === 'room_archived') return 'Nhóm đang lưu trữ. Khôi phục nhóm trước khi thêm thành viên.'
    if (error.reason === 'not_found') return 'Không tìm thấy nhóm hoặc tài khoản (có thể đã bị khoá).'
    if (error.reason === 'deputy_limit') return `Mỗi nhóm có tối đa ${MAX_DEPUTIES} phó nhóm.`
  }
  return describeError(error)
}

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Chưa có tin')

/** Tạo / sửa tên và mô tả nhóm. */
function GroupForm({ group, onClose, onDone }: { group: AdminGroup | null; onClose: () => void; onDone: (g: AdminGroup) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const save = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), description: description.trim() || null }
      return group ? adminApi.updateGroup(group.id, input) : adminApi.createGroup(input)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
      onDone(saved)
    },
  })
  const invalid = name.trim().length < 1 || name.trim().length > 50 || description.trim().length > 200
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!invalid && !save.isPending) save.mutate()
  }
  return (
    <Confirmation title={group ? 'Sửa thông tin nhóm' : 'Tạo nhóm mới'} busy={save.isPending} onClose={onClose} icon="channel">
      <form className="admin-form" onSubmit={submit}>
        <label>
          Tên nhóm
          <input autoFocus value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="VD: Dự án A" disabled={save.isPending} />
        </label>
        <label>
          Mô tả (không bắt buộc)
          <textarea rows={3} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} disabled={save.isPending} />
          <span className="admin-form-hint">{description.trim().length}/200 ký tự</span>
        </label>
        {!group && <p className="admin-form-hint">Bạn sẽ là trưởng nhóm của nhóm vừa tạo.</p>}
        {save.error && <p className="admin-inline-error admin-inline-error--flush" role="alert">{groupError(save.error)}</p>}
        <div className="admin-dialog-actions">
          <button type="button" className="admin-button" disabled={save.isPending} onClick={onClose}>Hủy</button>
          <button type="submit" className="admin-button admin-button--primary" disabled={invalid || save.isPending}>
            {save.isPending ? 'Đang lưu…' : group ? 'Lưu thay đổi' : 'Tạo nhóm'}
          </button>
        </div>
      </form>
    </Confirmation>
  )
}

/** Xem, thêm, xoá thành viên của một nhóm. */
function GroupMembers({ group, onClose, onNotice }: { group: AdminGroup; onClose: () => void; onNotice: (text: string) => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [newOwner, setNewOwner] = useState<GroupMember | null>(null)
  const [approval, setApproval] = useState(group.requireApproval)
  const query = useDebounced(search)
  const members = useQuery({ queryKey: ['admin', 'groups', group.id, 'members'], queryFn: () => adminApi.groupMembers(group.id), retry: false })
  const candidates = useQuery({ queryKey: ['admin', 'users', query, 0], queryFn: () => adminApi.users(query, 0), enabled: query.length > 0, retry: false })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] })
  const add = useMutation({
    mutationFn: (userId: string) => adminApi.addGroupMember(group.id, userId),
    onSuccess: (_g, userId) => {
      refresh()
      const who = candidates.data?.users.find((u) => u.id === userId)
      onNotice(`Đã thêm ${who?.displayName ?? 'thành viên'} vào nhóm ${group.name}.`)
    },
  })
  const remove = useMutation({
    mutationFn: (userId: string) => adminApi.removeGroupMember(group.id, userId),
    onSuccess: (_g, userId) => {
      refresh()
      setRemoving(null)
      const who = members.data?.find((m) => m.id === userId)
      onNotice(`Đã xoá ${who?.displayName ?? 'thành viên'} khỏi nhóm ${group.name}.`)
    },
  })
  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: GroupMember; role: GroupRole }) => adminApi.setGroupMemberRole(group.id, member.id, role),
    onSuccess: (list, { member, role }) => {
      queryClient.setQueryData(['admin', 'groups', group.id, 'members'], list)
      refresh()
      setNewOwner(null)
      onNotice(role === 'owner' ? `${member.displayName} là trưởng nhóm mới của ${group.name}.` : `${member.displayName} giờ là ${ROLE_LABEL[role].toLowerCase()} của ${group.name}.`)
    },
  })
  const toggleApproval = useMutation({
    mutationFn: (on: boolean) => adminApi.setGroupApproval(group.id, on),
    onMutate: (on) => setApproval(on),
    onError: (_e, on) => setApproval(!on),
    onSuccess: (saved) => {
      refresh()
      onNotice(saved.requireApproval ? `Đã bật phê duyệt thành viên mới cho ${group.name}.` : `Đã tắt phê duyệt thành viên mới cho ${group.name}.`)
    },
  })
  const busy = add.isPending || remove.isPending || changeRole.isPending
  const deputies = (members.data ?? []).filter((m) => m.memberRole === 'deputy').length
  const pickRole = (m: GroupMember, role: GroupRole) => {
    changeRole.reset()
    if (role === 'owner') setNewOwner(m)
    else changeRole.mutate({ member: m, role })
  }
  const memberIds = new Set((members.data ?? []).map((m) => m.id))
  const results = (candidates.data?.users ?? []).filter((u) => !memberIds.has(u.id))

  return (
    <Confirmation title={`Thành viên · ${group.name}`} busy={busy} onClose={onClose} icon="users" className="admin-dialog--wide">
      {group.archived && <p className="admin-form-hint">Nhóm đang lưu trữ: chỉ xem và xoá thành viên, khôi phục nhóm để thêm người.</p>}
      <label className="admin-switch">
        <input type="checkbox" role="switch" checked={approval} disabled={toggleApproval.isPending} onChange={(e) => toggleApproval.mutate(e.target.checked)} />
        <span>
          <strong>Phê duyệt thành viên mới</strong>
          <span>Thành viên thường thêm người thì phải chờ trưởng / phó nhóm duyệt.{group.pendingRequests > 0 && ` Đang có ${group.pendingRequests} yêu cầu chờ duyệt.`}</span>
        </span>
      </label>
      {toggleApproval.error && <p className="admin-inline-error admin-inline-error--flush" role="alert">{groupError(toggleApproval.error)}</p>}
      {!group.archived && (
        <label className="admin-search admin-search--flush">
          <span className="sr-only">Tìm tài khoản để thêm</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input type="search" placeholder="Tìm tên hoặc email để thêm vào nhóm…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      )}
      {query && !group.archived && (
        <ul className="admin-member-list admin-member-list--results" aria-label="Kết quả tìm kiếm">
          {candidates.isPending && <li className="admin-empty">Đang tìm…</li>}
          {candidates.isSuccess && results.length === 0 && <li className="admin-empty">Không có tài khoản phù hợp ngoài nhóm.</li>}
          {results.map((u) => (
            <li key={u.id}>
              <Avatar name={u.displayName} userId={u.id} size="sm" />
              <div><strong>{u.displayName}</strong><span>{u.email}</span></div>
              <button type="button" className="admin-button admin-button--small admin-button--primary" disabled={!u.enabled || busy} onClick={() => add.mutate(u.id)} aria-label={`Thêm ${u.email}`}>
                {u.enabled ? 'Thêm' : 'Đã khóa'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(add.error || remove.error || changeRole.error) && <p className="admin-inline-error admin-inline-error--flush" role="alert">{groupError(add.error ?? remove.error ?? changeRole.error)}</p>}
      {newOwner && (
        <div className="admin-owner-confirm" role="alertdialog" aria-label="Xác nhận chuyển trưởng nhóm">
          <span>Chuyển trưởng nhóm cho <strong>{newOwner.displayName}</strong>? Trưởng nhóm hiện tại sẽ thành thành viên thường.</span>
          <span className="admin-actions">
            <button type="button" className="admin-button admin-button--small" disabled={busy} onClick={() => setNewOwner(null)}>Hủy</button>
            <button type="button" className="admin-button admin-button--small admin-button--primary" disabled={busy} onClick={() => changeRole.mutate({ member: newOwner, role: 'owner' })}>
              {changeRole.isPending ? 'Đang chuyển…' : 'Xác nhận chuyển'}
            </button>
          </span>
        </div>
      )}
      <h3 className="admin-member-heading">{members.data ? `${members.data.length} thành viên · ${deputies}/${MAX_DEPUTIES} phó nhóm` : 'Thành viên'}</h3>
      <ul className="admin-member-list" aria-label="Thành viên nhóm">
        {members.isPending && <li className="admin-empty">Đang tải thành viên…</li>}
        {members.error && <li className="admin-inline-error" role="alert">{groupError(members.error)}</li>}
        {members.isSuccess && members.data.length === 0 && <li className="admin-empty">Nhóm chưa có thành viên.</li>}
        {members.data?.map((m) => (
          <li key={m.id}>
            <Avatar name={m.displayName} userId={m.id} size="sm" />
            <div>
              <strong>{m.displayName}</strong>
              <span>{m.email}{!m.enabled && ' · Đã khóa'}</span>
            </div>
            <select
              className="admin-role-select"
              aria-label={`Vai trò của ${m.displayName}`}
              value={m.memberRole ?? 'member'}
              disabled={busy || m.memberRole === 'owner'}
              title={m.memberRole === 'owner' ? 'Chọn trưởng nhóm mới ở một thành viên khác' : undefined}
              onChange={(e) => pickRole(m, e.target.value as GroupRole)}
            >
              <option value="owner" disabled={!m.enabled}>{ROLE_LABEL.owner}</option>
              <option value="deputy" disabled={m.memberRole !== 'deputy' && deputies >= MAX_DEPUTIES}>{ROLE_LABEL.deputy}</option>
              <option value="member">{ROLE_LABEL.member}</option>
            </select>
            {removing === m.id ? (
              <span className="admin-actions">
                <button type="button" className="admin-button admin-button--small" disabled={busy} onClick={() => setRemoving(null)}>Hủy</button>
                <button type="button" className="admin-button admin-button--small admin-button--danger-fill" disabled={busy} onClick={() => remove.mutate(m.id)}>
                  {remove.isPending ? 'Đang xoá…' : 'Xác nhận xoá'}
                </button>
              </span>
            ) : (
              <button type="button" className="admin-button admin-button--small admin-button--danger" disabled={busy} onClick={() => { remove.reset(); setRemoving(m.id) }} aria-label={`Xoá ${m.email} khỏi nhóm`}>
                Xoá
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="admin-dialog-actions">
        <button type="button" className="admin-button" disabled={busy} onClick={onClose}>Đóng</button>
      </div>
    </Confirmation>
  )
}

/** Quản lý nhóm (kênh) của admin: tìm, lọc, tạo, sửa, lưu trữ / khôi phục, quản lý thành viên. */
export function AdminGroups({ enabled, onNotice }: { enabled: boolean; onNotice: (text: string) => void }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [page, setPage] = useState(0)
  const [form, setForm] = useState<{ group: AdminGroup | null } | null>(null)
  const [archiving, setArchiving] = useState<AdminGroup | null>(null)
  const [membersOf, setMembersOf] = useState<AdminGroup | null>(null)
  const filter = useDebounced(search)
  useEffect(() => setPage(0), [filter, status])

  const archived = status === 'all' ? undefined : status === 'archived'
  const groups = useQuery({
    queryKey: ['admin', 'groups', filter, status, page],
    queryFn: () => adminApi.groups(filter, archived, page),
    enabled,
    retry: false,
    refetchInterval: 10000,
  })
  const archive = useMutation({
    mutationFn: (g: AdminGroup) => adminApi.archiveGroup(g.id, !g.archived),
    onSuccess: (saved) => {
      onNotice(saved.archived ? `Đã lưu trữ nhóm ${saved.name}. Thành viên vẫn đọc được lịch sử nhưng không gửi tin mới.` : `Đã khôi phục nhóm ${saved.name}.`)
      setArchiving(null)
      void queryClient.invalidateQueries({ queryKey: ['admin'] })
    },
  })
  const total = groups.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / (groups.data?.pageSize ?? 20)))

  return (
    <section className="admin-panel admin-groups" id="groups" aria-labelledby="groups-title">
      <div className="admin-panel-heading">
        <div>
          <h2 id="groups-title">Quản lý nhóm <span className="admin-count">{groups.data?.total ?? '—'}</span></h2>
          <p>Tạo, đổi tên, lưu trữ nhóm, quản lý thành viên, trưởng / phó nhóm và chế độ phê duyệt mà không cần tham gia nhóm.</p>
        </div>
        <button type="button" className="admin-button admin-button--primary" disabled={!enabled} onClick={() => setForm({ group: null })}>+ Tạo nhóm</button>
      </div>
      <div className="admin-groups-toolbar">
        <label className="admin-search admin-search--flush">
          <span className="sr-only">Tìm nhóm</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input type="search" placeholder="Tìm theo tên nhóm…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="admin-segment" role="group" aria-label="Lọc trạng thái nhóm">
          {([['all', 'Tất cả'], ['active', 'Đang hoạt động'], ['archived', 'Đã lưu trữ']] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>
          ))}
        </div>
      </div>
      {groups.error && <p className="admin-inline-error" role="alert">{describeError(groups.error)} <button onClick={() => void groups.refetch()}>Thử lại</button></p>}
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead><tr><th>Nhóm</th><th>Thành viên</th><th>Tin gần nhất</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {groups.isPending && enabled && <tr><td colSpan={5} className="admin-empty">Đang tải nhóm…</td></tr>}
            {groups.isSuccess && groups.data.groups.length === 0 && <tr><td colSpan={5} className="admin-empty">Không có nhóm phù hợp.</td></tr>}
            {groups.data?.groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <div className="admin-user-cell">
                    <span className="admin-channel-hash">#</span>
                    <div><strong>{g.name}</strong><span className="admin-group-desc">{g.description || 'Không có mô tả'}</span></div>
                  </div>
                </td>
                <td>{g.memberCount}</td>
                <td>{formatTime(g.lastMessageAt)}</td>
                <td>
                  <span className={`admin-user-state ${g.archived ? 'admin-user-state--banned' : 'admin-user-state--online'}`}><i />{g.archived ? 'Đã lưu trữ' : 'Hoạt động'}</span>
                  {g.requireApproval && <small className="admin-group-flag">Phê duyệt{g.pendingRequests > 0 ? ` · ${g.pendingRequests} chờ duyệt` : ''}</small>}
                </td>
                <td>
                  <div className="admin-actions">
                    <button type="button" className="admin-button admin-button--small" onClick={() => setMembersOf(g)} aria-label={`Thành viên nhóm ${g.name}`}>Thành viên</button>
                    <button type="button" className="admin-button admin-button--small" onClick={() => setForm({ group: g })} aria-label={`Sửa nhóm ${g.name}`}>Sửa</button>
                    <button
                      type="button"
                      className={`admin-button admin-button--small ${g.archived ? '' : 'admin-button--danger'}`}
                      onClick={() => { archive.reset(); setArchiving(g) }}
                      aria-label={`${g.archived ? 'Khôi phục' : 'Lưu trữ'} nhóm ${g.name}`}
                    >
                      {g.archived ? 'Khôi phục' : 'Lưu trữ'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-pagination">
        <span>{groups.data ? `${total} nhóm · Trang ${page + 1}/${pages}` : '—'}</span>
        <div>
          <button className="admin-button admin-button--small" disabled={page === 0 || groups.isFetching} onClick={() => setPage((p) => p - 1)}>Trước</button>
          <button className="admin-button admin-button--small" disabled={page + 1 >= pages || groups.isFetching} onClick={() => setPage((p) => p + 1)}>Sau</button>
        </div>
      </div>
      <p className="admin-footnote">Chỉ hiển thị nhóm (kênh), không gồm tin nhắn riêng. Admin không đọc nội dung chat. Nhóm lưu trữ vẫn giữ lịch sử nhưng không nhận tin mới.</p>

      {form && (
        <GroupForm
          group={form.group}
          onClose={() => setForm(null)}
          onDone={(saved) => { setForm(null); onNotice(form.group ? `Đã cập nhật nhóm ${saved.name}.` : `Đã tạo nhóm ${saved.name}.`) }}
        />
      )}
      {membersOf && <GroupMembers group={membersOf} onClose={() => setMembersOf(null)} onNotice={onNotice} />}
      {archiving && (
        <Confirmation title={archiving.archived ? 'Khôi phục nhóm này?' : 'Lưu trữ nhóm này?'} busy={archive.isPending} onClose={() => setArchiving(null)} icon="channel">
          <p><strong>{archiving.name}</strong> · {archiving.memberCount} thành viên</p>
          <p>{archiving.archived ? 'Thành viên sẽ gửi tin và file trong nhóm trở lại bình thường.' : 'Thành viên vẫn đọc được lịch sử, nhưng không gửi tin, file hay thêm người mới cho tới khi khôi phục.'}</p>
          {archive.error && <p className="admin-inline-error admin-inline-error--flush" role="alert">{groupError(archive.error)}</p>}
          <div className="admin-dialog-actions">
            <button className="admin-button" autoFocus disabled={archive.isPending} onClick={() => setArchiving(null)}>Hủy</button>
            <button className={`admin-button ${archiving.archived ? 'admin-button--primary' : 'admin-button--danger-fill'}`} disabled={archive.isPending} onClick={() => archive.mutate(archiving)}>
              {archive.isPending ? 'Đang xử lý…' : archiving.archived ? 'Xác nhận khôi phục' : 'Xác nhận lưu trữ'}
            </button>
          </div>
        </Confirmation>
      )}
    </section>
  )
}
