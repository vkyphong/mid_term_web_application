import { useMemo, useState } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useAddMembers, useRoomMembers } from '../hooks'
import type { Room, UserSummary } from '../types'
import { pushToast } from '../notifications'
import { MemberPicker } from './MemberPicker'
import { Modal } from './Modal'

/** Thêm người vào kênh đang mở; mọi thành viên đều có quyền thêm (theo BE). */
export function AddMembersDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const members = useRoomMembers(room.id)
  const add = useAddMembers(room.id)
  const [selected, setSelected] = useState<UserSummary[]>([])
  const existingIds = useMemo(() => new Set(members.data?.map((m) => m.id)), [members.data])
  const partial = add.data?.failed.length ? add.data.failed : null

  const submit = () =>
    add.mutate(
      selected.map((u) => u.id),
      {
        onSuccess: ({ failed, pending }) => {
          if (pending > 0) {
            pushToast({
              id: `pending-${room.id}-${Date.now()}`,
              title: 'Đã gửi yêu cầu thêm thành viên',
              body: `${pending} người đang chờ trưởng nhóm / phó nhóm duyệt.`,
            })
          }
          if (failed.length === 0) onClose()
          else setSelected((list) => list.filter((u) => failed.some((f) => f.userId === u.id)))
        },
      },
    )

  return (
    <Modal title={`Thêm thành viên vào #${room.name}`} onClose={onClose}>
      {add.error && <FormAlert>{describeChatError(add.error)}</FormAlert>}
      {partial && (
        <FormAlert>
          Chưa thêm được {partial.length} người: {describeChatError(partial[0].error)}
        </FormAlert>
      )}
      {room.requireApproval && room.myRole === 'member' && (
        <p className="approval-note">🛡️ Nhóm đang bật phê duyệt: người bạn thêm sẽ vào nhóm sau khi trưởng nhóm hoặc phó nhóm duyệt.</p>
      )}
      <MemberPicker selected={selected} onChange={setSelected} existingIds={existingIds} disabled={add.isPending} />
      <button type="button" className="btn-primary" disabled={selected.length === 0 || add.isPending} onClick={submit}>
        {add.isPending
          ? 'Đang thêm…'
          : room.requireApproval && room.myRole === 'member'
            ? selected.length > 0 ? `Gửi yêu cầu thêm ${selected.length} người` : 'Gửi yêu cầu'
            : selected.length > 0 ? `Thêm ${selected.length} người` : 'Thêm'}
      </button>
    </Modal>
  )
}
