import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../../lib/apiError'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useCreateRoom } from '../hooks'
import { Modal } from './Modal'

export function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const createRoom = useCreateRoom()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState<string>()

  const serverError = createRoom.error
  const serverNameError =
    serverError instanceof ApiError && (serverError.reason === 'room_name_taken' || serverError.details.some((d) => d.field === 'name'))
      ? describeChatError(serverError)
      : undefined

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 40) {
      setNameError('Tên kênh cần 2–40 ký tự')
      return
    }
    createRoom.mutate(
      { name: trimmed, description: description.trim() || undefined },
      {
        onSuccess: (room) => {
          onClose()
          navigate(`/rooms/${room.id}`)
        },
      },
    )
  }

  return (
    <Modal title="Tạo kênh mới" onClose={onClose}>
      {serverError && !serverNameError && <FormAlert>{describeChatError(serverError)}</FormAlert>}
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Tên kênh"
          name="name"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => {
            setName(e.target.value)
            setNameError(undefined)
            if (createRoom.error) createRoom.reset()
          }}
          error={nameError ?? serverNameError}
          hint="Ví dụ: Dự án Alpha, Phòng Tài chính"
        />
        <TextField
          label="Mô tả (không bắt buộc)"
          name="description"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={createRoom.isPending}>
          {createRoom.isPending ? 'Đang tạo…' : 'Tạo kênh'}
        </button>
      </form>
    </Modal>
  )
}
