import { useNavigate } from 'react-router-dom'
import { FormAlert } from '../../auth/components/FormAlert'
import { describeChatError } from '../errors'
import { useJoinRoom, useRooms } from '../hooks'
import type { Room } from '../types'
import { Modal } from './Modal'

export function BrowseChannelsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const rooms = useRooms()
  const join = useJoinRoom()
  const channels = (rooms.data ?? [])
    .filter((r) => r.type === 'channel')
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))

  const open = (room: Room) => {
    onClose()
    navigate(`/rooms/${room.id}`)
  }

  return (
    <Modal title="Duyệt kênh" onClose={onClose}>
      {join.error && <FormAlert>{describeChatError(join.error)}</FormAlert>}
      {rooms.isPending && <p className="muted">Đang tải…</p>}
      <ul className="channel-browser">
        {channels.map((room) => (
          <li key={room.id}>
            <div className="channel-browser-info">
              <strong># {room.name}</strong>
              {room.description && <span className="muted">{room.description}</span>}
              <span className="muted small">{room.memberCount} thành viên</span>
            </div>
            {room.joined ? (
              <button type="button" className="btn-secondary" onClick={() => open(room)}>
                Mở
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                disabled={join.isPending && join.variables === room.id}
                onClick={() => join.mutate(room.id, { onSuccess: open })}
                aria-label={`Tham gia ${room.name}`}
              >
                Tham gia
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
