import { useState } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useDecideMemberRequest, useMemberRequests, useRoomMembers, useRoomSettings, useSetMemberRole } from '../hooks'
import { MAX_DEPUTIES, ROLE_LABEL } from '../roles'
import { openProfile } from '../profileViewer'
import type { Room } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

/** Danh sách thành viên kèm vai trò; trưởng nhóm bổ nhiệm / bỏ phó nhóm (tối đa 5). */
export function MembersDialog(props: { room: Room; selfId: string; onClose: () => void; onAddMembers?: () => void }) {
  const { room, selfId, onClose, onAddMembers } = props
  const members = useRoomMembers(room.id)
  const setRole = useSetMemberRole(room.id)
  const isOwner = room.myRole === 'owner' && !room.archived
  const deputies = members.data?.filter((m) => m.memberRole === 'deputy').length ?? 0
  const isLeader = (room.myRole === 'owner' || room.myRole === 'deputy') && !room.archived
  const settings = useRoomSettings(room.id)
  // Giá trị vừa bấm, giữ tới khi server trả lời (cập nhật đồng bộ nên công tắc không bị giật về trạng thái cũ).
  const [approvalDraft, setApprovalDraft] = useState<boolean | null>(null)
  const requests = useMemberRequests(room.id, isLeader, room.pendingRequests ?? 0)
  const decide = useDecideMemberRequest(room.id)

  return (
    <Modal title={`Thành viên (${room.memberCount})`} onClose={onClose}>
      {(setRole.error || settings.error || decide.error) && <FormAlert>{describeChatError(setRole.error ?? settings.error ?? decide.error)}</FormAlert>}
      {isOwner ? (
        <label className="approval-toggle">
          <input
            type="checkbox"
            role="switch"
            // Đổi ngay khi bấm, không đợi server (lỗi thì quay về giá trị của server).
            checked={approvalDraft ?? Boolean(room.requireApproval)}
            disabled={settings.isPending}
            onChange={(e) => {
              setApprovalDraft(e.target.checked)
              settings.mutate(e.target.checked, { onSettled: () => setApprovalDraft(null) })
            }}
          />
          <span>
            <strong>Phê duyệt thành viên mới</strong>
            <span className="muted small">
              {(approvalDraft ?? room.requireApproval)
                ? 'Đang bật: thành viên thường thêm người thì cần trưởng / phó nhóm duyệt.'
                : 'Đang tắt: mọi thành viên đều tự thêm người được.'}
            </span>
          </span>
        </label>
      ) : (
        room.requireApproval && <p className="approval-note">🛡️ Nhóm đang bật phê duyệt thành viên mới.</p>
      )}
      {isLeader && (requests.data?.length ?? 0) > 0 && (
        <section className="member-requests" aria-label="Yêu cầu chờ duyệt">
          <h3>Yêu cầu chờ duyệt ({requests.data!.length})</h3>
          <ul className="user-results">
            {requests.data!.map((r) => {
              const busy = decide.isPending && decide.variables?.requestId === r.id
              return (
                <li key={r.id} className="member-role-row">
                  <Avatar name={r.user.displayName} userId={r.user.id} />
                  <span className="member-role-text">
                    <strong>{r.user.displayName}</strong>
                    <span className="muted small">Do {r.requestedBy.displayName} thêm</span>
                  </span>
                  <button type="button" className="btn-secondary btn-inline" disabled={busy} onClick={() => decide.mutate({ requestId: r.id, approve: false })}>
                    Từ chối
                  </button>
                  <button type="button" className="btn-primary btn-inline" disabled={busy} onClick={() => decide.mutate({ requestId: r.id, approve: true })}>
                    Duyệt
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <p className="muted small">
        Chìa khoá vàng: trưởng nhóm · chìa khoá bạc: phó nhóm ({deputies}/{MAX_DEPUTIES})
        {isOwner ? '. Bạn có thể bổ nhiệm tối đa 5 phó nhóm.' : ''}
      </p>
      {members.isPending && <p className="muted small">Đang tải…</p>}
      {members.error && <p className="field-error">{describeChatError(members.error)}</p>}
      <ul className="user-results member-roles">
        {members.data?.map((m) => {
          const role = m.memberRole ?? 'member'
          const busy = setRole.isPending && setRole.variables?.userId === m.id
          return (
            <li key={m.id} className="member-role-row">
              <button type="button" className="avatar-btn" aria-label={`Xem thông tin ${m.displayName}`} onClick={() => openProfile(m.id)}>
                <Avatar name={m.displayName} userId={m.id} role={role} />
              </button>
              <span className="member-role-text">
                <strong>
                  {m.displayName}
                  {m.id === selfId && <span className="muted small"> (bạn)</span>}
                </strong>
                <span className={`muted small${role !== 'member' ? ` member-role-label member-role-label--${role}` : ''}`}>
                  {ROLE_LABEL[role]}
                  {m.enabled === false ? ' · đã khoá' : ''}
                </span>
              </span>
              {isOwner && role !== 'owner' && (
                <button
                  type="button"
                  className="btn-secondary btn-inline"
                  disabled={busy || (role === 'member' && deputies >= MAX_DEPUTIES)}
                  title={role === 'member' && deputies >= MAX_DEPUTIES ? 'Nhóm đã có đủ 5 phó nhóm' : undefined}
                  onClick={() => setRole.mutate({ userId: m.id, role: role === 'deputy' ? 'member' : 'deputy' })}
                >
                  {role === 'deputy' ? 'Bỏ phó nhóm' : 'Bổ nhiệm phó nhóm'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {onAddMembers && (
        <button type="button" className="btn-primary" onClick={onAddMembers}>
          Thêm thành viên
        </button>
      )}
    </Modal>
  )
}
