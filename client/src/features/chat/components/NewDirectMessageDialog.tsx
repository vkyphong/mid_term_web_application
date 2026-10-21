import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useOpenDm, useUserSearch } from '../hooks'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function NewDirectMessageDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const users = useUserSearch(query)
  const openDm = useOpenDm()

  const start = (userId: string) =>
    openDm.mutate(userId, {
      onSuccess: (room) => {
        onClose()
        navigate(`/rooms/${room.id}`)
      },
    })

  return (
    <Modal title="Tin nhắn mới" onClose={onClose}>
      {(openDm.error || users.error) && <FormAlert>{describeChatError(openDm.error ?? users.error)}</FormAlert>}
      <TextField
        label="Tìm nhân viên"
        name="search"
        type="search"
        placeholder="Tên hoặc email"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {users.isPending && <p className="muted">Đang tìm…</p>}
      {users.data?.length === 0 && <p className="muted">Không tìm thấy nhân viên phù hợp.</p>}
      <ul className="user-results">
        {users.data?.map((u) => (
          <li key={u.id}>
            <button type="button" className="user-result" disabled={openDm.isPending} onClick={() => start(u.id)}>
              <Avatar name={u.displayName} />
              <span>
                <strong>{u.displayName}</strong>
                <span className="muted small">{u.email}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
