import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError } from '../../../lib/apiError'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useRemoveRoomAvatar, useRenameRoom, useSetNickname, useUploadRoomAvatar } from '../hooks'
import { formatBytes } from '../uploads'
import type { Room } from '../types'
import { Modal } from './Modal'
import { RoomAvatar } from './RoomAvatar'

/** Lỗi gắn với ô nhập (validation / tên trùng) hiện dưới ô, lỗi khác hiện ở đầu hộp thoại. */
function fieldError(error: unknown, field: string) {
  return error instanceof ApiError && (error.reason === 'room_name_taken' || error.details.some((d) => d.field === field))
    ? describeChatError(error)
    : undefined
}

export function RenameGroupDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const rename = useRenameRoom(room.id)
  const [name, setName] = useState(room.name)
  const [error, setError] = useState<string>()
  const serverField = fieldError(rename.error, 'name')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 40) return setError('Tên nhóm cần 2–40 ký tự')
    if (trimmed === room.name) return onClose()
    rename.mutate(trimmed, { onSuccess: onClose })
  }

  return (
    <Modal title="Đổi tên nhóm" onClose={onClose}>
      {rename.error && !serverField && <FormAlert>{describeChatError(rename.error)}</FormAlert>}
      <p className="muted small">Mọi thành viên sẽ thấy tên mới.</p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Tên nhóm"
          name="name"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => {
            setName(e.target.value)
            setError(undefined)
            if (rename.error) rename.reset()
          }}
          error={error ?? serverField}
        />
        <button type="submit" className="btn-primary" disabled={rename.isPending}>
          {rename.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
      </form>
    </Modal>
  )
}

export function NicknameDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const setNickname = useSetNickname(room.id)
  const realName = room.peer?.displayName ?? room.name
  const [nickname, setValue] = useState(room.nickname ?? '')
  const serverField = fieldError(setNickname.error, 'nickname')

  const save = (value: string) => setNickname.mutate(value, { onSuccess: onClose })
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save(nickname.trim())
  }

  return (
    <Modal title="Đổi biệt danh" onClose={onClose}>
      {setNickname.error && !serverField && <FormAlert>{describeChatError(setNickname.error)}</FormAlert>}
      <p className="muted small">Biệt danh của {realName} chỉ hiện với bạn.</p>
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Biệt danh"
          name="nickname"
          value={nickname}
          maxLength={40}
          placeholder={realName}
          autoFocus
          onChange={(e) => {
            setValue(e.target.value)
            if (setNickname.error) setNickname.reset()
          }}
          error={serverField}
          hint="Để trống để dùng tên thật"
        />
        <div className="dialog-actions">
          {room.nickname && (
            <button type="button" className="btn-secondary" disabled={setNickname.isPending} onClick={() => save('')}>
              Xoá biệt danh
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={setNickname.isPending}>
            {setNickname.isPending ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export function GroupAvatarDialog({ room, onClose }: { room: Room; onClose: () => void }) {
  const upload = useUploadRoomAvatar(room.id)
  const remove = useRemoveRoomAvatar(room.id)
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const busy = upload.isPending || remove.isPending
  const serverError = upload.error ?? remove.error

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    if (!/\.(png|jpe?g)$/i.test(file.name)) return setError('Chỉ dùng được ảnh JPG hoặc PNG.')
    if (file.size === 0) return setError('Tệp rỗng.')
    if (file.size > AVATAR_MAX_BYTES) return setError(`Ảnh ${formatBytes(file.size)} vượt quá giới hạn 2 MB.`)
    upload.mutate(file, { onSuccess: onClose })
  }

  return (
    <Modal title="Ảnh nhóm" onClose={onClose}>
      {(error || serverError) && <FormAlert>{error ?? describeChatError(serverError)}</FormAlert>}
      <div className="group-avatar-preview">
        <RoomAvatar room={room} size="lg" />
        <p className="muted small">
          {room.avatarUrl ? 'Mọi thành viên đều thấy ảnh này.' : 'Đang dùng ảnh ghép từ thành viên. Chọn ảnh JPG/PNG tối đa 2 MB để đặt ảnh nhóm.'}
        </p>
      </div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png" hidden onChange={onPick} data-testid="group-avatar-input" />
      <div className="dialog-actions">
        {room.avatarUrl && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>
            Dùng ảnh ghép thành viên
          </button>
        )}
        <button type="button" className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {upload.isPending ? 'Đang tải lên…' : 'Chọn ảnh'}
        </button>
      </div>
    </Modal>
  )
}
