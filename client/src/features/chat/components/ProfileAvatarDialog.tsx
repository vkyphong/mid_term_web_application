import { useRef, useState, type ChangeEvent } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { useUserAvatarUrl } from '../avatars'
import { describeChatError } from '../errors'
import { useRemoveMyAvatar, useUploadMyAvatar } from '../hooks'
import { formatBytes } from '../uploads'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

const MAX_BYTES = 5 * 1024 * 1024

/** Đổi ảnh đại diện tài khoản; mọi đồng nghiệp thấy ngay (event user:avatar). */
export function ProfileAvatarDialog({ user, onClose }: { user: { id: string; displayName: string }; onClose: () => void }) {
  const upload = useUploadMyAvatar()
  const remove = useRemoveMyAvatar()
  const hasAvatar = Boolean(useUserAvatarUrl(user.id))
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
    if (file.size > MAX_BYTES) return setError(`Ảnh ${formatBytes(file.size)} vượt quá giới hạn 5 MB.`)
    upload.mutate(file, { onSuccess: onClose })
  }

  return (
    <Modal title="Ảnh đại diện" onClose={onClose}>
      {(error || serverError) && <FormAlert>{error ?? describeChatError(serverError)}</FormAlert>}
      <div className="group-avatar-preview">
        <Avatar name={user.displayName} userId={user.id} size="lg" />
        <p className="muted small">
          {hasAvatar ? 'Mọi đồng nghiệp đều thấy ảnh này.' : 'Chọn ảnh JPG/PNG tối đa 5 MB làm ảnh đại diện.'}
        </p>
      </div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png" hidden onChange={onPick} data-testid="profile-avatar-input" />
      <div className="dialog-actions">
        {hasAvatar && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>
            Xoá ảnh
          </button>
        )}
        <button type="button" className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          {upload.isPending ? 'Đang tải lên…' : 'Chọn ảnh'}
        </button>
      </div>
    </Modal>
  )
}
