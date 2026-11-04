import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useRoomMembers, useSetMemberRole } from '../hooks'
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

  return (
    <Modal title={`Thành viên (${room.memberCount})`} onClose={onClose}>
      {setRole.error && <FormAlert>{describeChatError(setRole.error)}</FormAlert>}
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
