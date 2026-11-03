import { useMemo, useState } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useAddMembers, useRoomMembers } from '../hooks'
import type { Room, UserSummary } from '../types'
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
        onSuccess: ({ failed }) => {
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
      <MemberPicker selected={selected} onChange={setSelected} existingIds={existingIds} disabled={add.isPending} />
      <button type="button" className="btn-primary" disabled={selected.length === 0 || add.isPending} onClick={submit}>
        {add.isPending ? 'Đang thêm…' : selected.length > 0 ? `Thêm ${selected.length} người` : 'Thêm'}
      </button>
    </Modal>
  )
}
