import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ApiError } from '../../../lib/apiError'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { useUserAvatarUrl } from '../avatars'
import { describeChatError } from '../errors'
import { useMyProfile, useRemoveMyAvatar, useUpdateProfile, useUploadMyAvatar } from '../hooks'
import { formatBytes } from '../uploads'
import type { Gender, Profile } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

const MAX_BYTES = 5 * 1024 * 1024
const GENDER_LABEL: Record<Gender, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' }

/** "2006-05-18" → "18 tháng 05, 2006" như Zalo. */
function formatBirthDate(value: string | null) {
  if (!value) return null
  const [y, m, d] = value.split('-')
  return `${d} tháng ${m}, ${y}`
}

/** Danh sách thông tin cá nhân (hồ sơ của mình, hoặc hồ sơ công khai của người khác). */
export function ProfileDetails({ profile }: { profile: Profile }) {
  const empty = <span className="muted">Chưa cập nhật</span>
  return (
    <section className="profile-info" aria-label="Thông tin cá nhân">
      <h4>Thông tin cá nhân</h4>
      <dl>
        <dt>Giới tính</dt>
        <dd>{profile.gender ? GENDER_LABEL[profile.gender] : empty}</dd>
        <dt>Ngày sinh</dt>
        <dd>{formatBirthDate(profile.birthDate) ?? empty}</dd>
        <dt>Điện thoại</dt>
        <dd>{profile.phone ?? empty}</dd>
        <dt>Email</dt>
        <dd>{profile.email}</dd>
        {profile.self && (
          <>
            <dt>Chế độ</dt>
            <dd>{profile.profilePublic ? '🌐 Công khai' : '🔒 Riêng tư'}</dd>
          </>
        )}
      </dl>
      {profile.self && (
        <p className="muted small">
          {profile.profilePublic
            ? 'Mọi đồng nghiệp xem được giới tính, ngày sinh và điện thoại của bạn.'
            : 'Chỉ bạn xem được giới tính, ngày sinh và điện thoại.'}
        </p>
      )}
    </section>
  )
}

function fieldError(error: unknown, field: string) {
  return error instanceof ApiError ? error.details.find((d) => d.field === field)?.message : undefined
}

function EditProfileForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const update = useUpdateProfile()
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [gender, setGender] = useState<Gender | ''>(profile.gender ?? '')
  const [birthDate, setBirthDate] = useState(profile.birthDate ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [profilePublic, setProfilePublic] = useState(profile.profilePublic)
  const [nameError, setNameError] = useState<string>()

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const name = displayName.trim()
    if (name.length < 2 || name.length > 50) return setNameError('Tên hiển thị cần 2–50 ký tự')
    update.mutate({ displayName: name, gender, birthDate, phone: phone.trim(), profilePublic }, { onSuccess: onDone })
  }
  const general = update.error && !(update.error instanceof ApiError && update.error.details.length) ? describeChatError(update.error) : undefined

  return (
    <form className="profile-form" onSubmit={onSubmit} noValidate>
      {general && <FormAlert>{general}</FormAlert>}
      <TextField
        label="Tên hiển thị"
        name="displayName"
        value={displayName}
        maxLength={50}
        autoFocus
        onChange={(e) => {
          setDisplayName(e.target.value)
          setNameError(undefined)
        }}
        error={nameError ?? fieldError(update.error, 'displayName')}
      />
      <fieldset className="member-fieldset">
        <legend>Giới tính</legend>
        <div className="profile-genders">
          {(['male', 'female', 'other'] as const).map((g) => (
            <label key={g} className="checkbox-row">
              <input type="radio" name="gender" checked={gender === g} onChange={() => setGender(g)} />
              {GENDER_LABEL[g]}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField
        label="Ngày sinh"
        name="birthDate"
        type="date"
        value={birthDate}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setBirthDate(e.target.value)}
        error={fieldError(update.error, 'birthDate')}
      />
      <TextField
        label="Điện thoại"
        name="phone"
        type="tel"
        value={phone}
        maxLength={20}
        placeholder="Ví dụ: 0901 234 567"
        onChange={(e) => setPhone(e.target.value)}
        error={fieldError(update.error, 'phone')}
      />
      <fieldset className="member-fieldset">
        <legend>Ai xem được thông tin cá nhân</legend>
        <div className="profile-genders">
          <label className="checkbox-row">
            <input type="radio" name="privacy" checked={profilePublic} onChange={() => setProfilePublic(true)} />
            🌐 Công khai
          </label>
          <label className="checkbox-row">
            <input type="radio" name="privacy" checked={!profilePublic} onChange={() => setProfilePublic(false)} />
            🔒 Riêng tư
          </label>
        </div>
      </fieldset>
      <div className="dialog-actions">
        <button type="button" className="btn-secondary" disabled={update.isPending} onClick={onDone}>
          Huỷ
        </button>
        <button type="submit" className="btn-primary" disabled={update.isPending}>
          {update.isPending ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </form>
  )
}

/**
 * "Thông tin tài khoản" như Zalo: ảnh bìa, avatar (bấm vào để chọn ảnh mới từ máy), tên,
 * thông tin cá nhân và nút Cập nhật. Chỉ chủ tài khoản xem / sửa được.
 */
export function ProfileAvatarDialog({ user, onClose }: { user: { id: string; displayName: string }; onClose: () => void }) {
  const profile = useMyProfile()
  const upload = useUploadMyAvatar()
  const remove = useRemoveMyAvatar()
  const hasAvatar = Boolean(useUserAvatarUrl(user.id))
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()
  const busy = upload.isPending || remove.isPending
  const avatarError = error ?? (upload.error || remove.error ? describeChatError(upload.error ?? remove.error) : undefined)
  const data = profile.data
  const name = data?.displayName ?? user.displayName

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    if (!/\.(png|jpe?g)$/i.test(file.name)) return setError('Chỉ dùng được ảnh JPG hoặc PNG.')
    if (file.size === 0) return setError('Tệp rỗng.')
    if (file.size > MAX_BYTES) return setError(`Ảnh ${formatBytes(file.size)} vượt quá giới hạn 5 MB.`)
    upload.mutate(file)
  }

  return (
    <Modal title="Thông tin tài khoản" onClose={onClose}>
      <div className="profile-card">
        <div className="profile-cover" aria-hidden="true" />
        <div className="profile-head">
          <button
            type="button"
            className="profile-avatar-btn"
            aria-label="Đổi ảnh đại diện"
            title="Bấm để chọn ảnh từ máy"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Avatar name={name} userId={user.id} size="lg" />
            <span className="profile-avatar-camera" aria-hidden="true">📷</span>
          </button>
          <h3 className="profile-name">{name}</h3>
          {!editing && (
            <button type="button" className="icon-btn" aria-label="Sửa tên và thông tin" title="Sửa thông tin" onClick={() => setEditing(true)}>
              ✏️
            </button>
          )}
        </div>
        <input ref={input} type="file" accept=".jpg,.jpeg,.png" hidden onChange={onPick} data-testid="profile-avatar-input" />
        {upload.isPending && <p className="muted small">Đang tải ảnh lên…</p>}
        {avatarError && <FormAlert>{avatarError}</FormAlert>}
        {hasAvatar && !editing && (
          <button type="button" className="link-btn profile-remove-avatar" disabled={busy} onClick={() => remove.mutate()}>
            Xoá ảnh đại diện
          </button>
        )}

        {profile.error && <FormAlert>{describeChatError(profile.error)}</FormAlert>}
        {editing && data ? (
          <EditProfileForm profile={data} onDone={() => setEditing(false)} />
        ) : (
          <>
            {profile.isPending && <p className="muted small">Đang tải…</p>}
            {data && <ProfileDetails profile={{ ...data, self: true }} />}
            <button type="button" className="btn-secondary profile-update" disabled={!data} onClick={() => setEditing(true)}>
              ✏️ Cập nhật
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
