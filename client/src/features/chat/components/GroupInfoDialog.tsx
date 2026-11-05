import { useRef, useState, type ChangeEvent } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { useAuthImage } from '../avatars'
import { downloadAttachment } from '../downloads'
import { describeChatError } from '../errors'
import { useRemoveRoomAvatar, useRoomMedia, useRoomMembers, useUploadRoomAvatar } from '../hooks'
import { roleOf } from '../roles'
import { fileKind, formatBytes, type FileKind } from '../uploads'
import type { MediaItem, MediaKind, Room } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { RoomAvatar } from './RoomAvatar'

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PREVIEW = { image: 3, file: 3, link: 3 } as const
const TITLES: Record<MediaKind, string> = { image: 'Ảnh/Video', file: 'File', link: 'Link' }
const EMPTY: Record<MediaKind, string> = {
  image: 'Chưa có ảnh nào được gửi trong nhóm.',
  file: 'Chưa có file nào được gửi trong nhóm.',
  link: 'Chưa có link nào được gửi trong nhóm.',
}
const FILE_ICONS: Record<FileKind, string> = { image: '🖼️', pdf: '📕', word: '📘', excel: '📗', powerpoint: '📙', archive: '🗜️', text: '📄' }

const when = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** Ảnh thu nhỏ (tải bằng Bearer); bấm để mở ảnh gốc ở tab mới. */
function ImageThumb({ item }: { item: MediaItem }) {
  const src = useAuthImage(item.attachment?.url)
  const name = item.attachment?.filename ?? 'Ảnh'
  return (
    <a
      className="media-thumb"
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title={`${name} · ${item.sender.displayName} · ${when(item.createdAt)}`}
      aria-label={`Ảnh ${name}`}
      onClick={(e) => !src && e.preventDefault()}
    >
      {src ? <img src={src} alt={name} /> : <span className="muted small">Đang tải…</span>}
    </a>
  )
}

function FileRow({ item }: { item: MediaItem }) {
  const a = item.attachment!
  const [error, setError] = useState<string>()
  return (
    <li>
      <button
        type="button"
        className="media-row"
        onClick={() => {
          setError(undefined)
          downloadAttachment(a).catch((err) => setError(describeChatError(err)))
        }}
      >
        <span className="media-row-icon" aria-hidden="true">{FILE_ICONS[fileKind(a.filename, a.mediaType)]}</span>
        <span className="media-row-text">
          <strong>{a.filename}</strong>
          <span className="muted small">
            {formatBytes(a.size)} · {item.sender.displayName} · {when(item.createdAt)}
          </span>
        </span>
      </button>
      {error && <p className="field-error small">{error}</p>}
    </li>
  )
}

function LinkRow({ item }: { item: MediaItem }) {
  const url = item.url!
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* link không chuẩn: hiện nguyên văn */
  }
  return (
    <li>
      <a className="media-row" href={url} target="_blank" rel="noopener noreferrer nofollow">
        <span className="media-row-icon" aria-hidden="true">🔗</span>
        <span className="media-row-text">
          <strong>{host}</strong>
          <span className="muted small media-link-url">{url}</span>
          <span className="muted small">
            {item.sender.displayName} · {when(item.createdAt)}
          </span>
        </span>
      </a>
    </li>
  )
}

/** Một mục Ảnh/Video, File hoặc Link: xem trước vài mục, "Xem tất cả" để xem hết và tải thêm. */
function MediaSection({ roomId, kind, full, onShowAll }: { roomId: string; kind: MediaKind; full: boolean; onShowAll: () => void }) {
  const media = useRoomMedia(roomId, kind)
  const all = media.data?.pages.flatMap((p) => p.items) ?? []
  const items = full ? all : all.slice(0, PREVIEW[kind])
  const hasMore = all.length > PREVIEW[kind] || media.hasNextPage

  return (
    <section className="group-info-section" aria-label={TITLES[kind]}>
      <div className="group-info-section-head">
        <h3>{TITLES[kind]}</h3>
        {!full && hasMore && (
          <button type="button" className="link-btn" onClick={onShowAll}>
            Xem tất cả
          </button>
        )}
      </div>
      {media.isPending && <p className="muted small">Đang tải…</p>}
      {media.error && <p className="field-error small">{describeChatError(media.error)}</p>}
      {media.isSuccess && all.length === 0 && <p className="muted small">{EMPTY[kind]}</p>}
      {kind === 'image' ? (
        <div className="media-grid">
          {items.map((item) => (
            <ImageThumb key={item.messageId} item={item} />
          ))}
          {!full && hasMore && (
            <button type="button" className="media-thumb media-thumb--more" aria-label="Xem tất cả ảnh" onClick={onShowAll}>
              →
            </button>
          )}
        </div>
      ) : (
        <ul className="media-list">
          {items.map((item, i) => (kind === 'file' ? <FileRow key={item.messageId} item={item} /> : <LinkRow key={`${item.messageId}-${i}`} item={item} />))}
        </ul>
      )}
      {full && media.hasNextPage && (
        <button type="button" className="btn-secondary" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>
          {media.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm'}
        </button>
      )}
    </section>
  )
}

interface GroupInfoDialogProps {
  room: Room
  onClose: () => void
  /** Mở hộp thoại đổi tên nhóm. */
  onRename: () => void
  /** Mở danh sách thành viên / quản lý nhóm (phân quyền, phê duyệt). */
  onManage: () => void
  onLeave: () => void
}

/** Thông tin nhóm: ảnh, tên, thành viên, lịch sử Ảnh/Video, File, Link. */
export function GroupInfoDialog({ room, onClose, onRename, onManage, onLeave }: GroupInfoDialogProps) {
  const canEdit = room.type === 'channel' && !room.archived
  const members = useRoomMembers(room.id)
  const upload = useUploadRoomAvatar(room.id)
  const remove = useRemoveRoomAvatar(room.id)
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const [view, setView] = useState<MediaKind | null>(null)
  const busy = upload.isPending || remove.isPending
  const avatarError = error ?? (upload.error || remove.error ? describeChatError(upload.error ?? remove.error) : undefined)

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(undefined)
    if (!/\.(png|jpe?g)$/i.test(file.name)) return setError('Chỉ dùng được ảnh JPG hoặc PNG.')
    if (file.size === 0) return setError('Tệp rỗng.')
    if (file.size > AVATAR_MAX_BYTES) return setError(`Ảnh ${formatBytes(file.size)} vượt quá giới hạn 2 MB.`)
    upload.mutate(file)
  }

  if (view) {
    return (
      <Modal title={TITLES[view]} onClose={onClose}>
        <button type="button" className="link-btn group-info-back" onClick={() => setView(null)}>
          ← Thông tin nhóm
        </button>
        <MediaSection roomId={room.id} kind={view} full onShowAll={() => {}} />
      </Modal>
    )
  }

  const shown = members.data?.slice(0, 5) ?? []
  return (
    <Modal title="Thông tin nhóm" onClose={onClose}>
      <div className="group-info-head">
        {canEdit ? (
          <button type="button" className="profile-avatar-btn" aria-label="Đổi ảnh nhóm" title="Bấm để chọn ảnh nhóm từ máy" disabled={busy} onClick={() => input.current?.click()}>
            <RoomAvatar room={room} size="lg" />
            <span className="profile-avatar-camera" aria-hidden="true">📷</span>
          </button>
        ) : (
          <RoomAvatar room={room} size="lg" />
        )}
        <h3 className="profile-name">{room.name}</h3>
        {canEdit && (
          <button type="button" className="icon-btn" aria-label="Đổi tên nhóm" title="Đổi tên nhóm" onClick={onRename}>
            ✏️
          </button>
        )}
      </div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png" hidden onChange={onPick} data-testid="group-avatar-input" />
      {upload.isPending && <p className="muted small">Đang tải ảnh lên…</p>}
      {avatarError && <FormAlert>{avatarError}</FormAlert>}
      {canEdit && room.avatarUrl && (
        <button type="button" className="link-btn profile-remove-avatar" disabled={busy} onClick={() => remove.mutate(undefined)}>
          Dùng ảnh ghép thành viên
        </button>
      )}

      <section className="group-info-section" aria-label="Thành viên">
        <div className="group-info-section-head">
          <h3>Thành viên ({room.memberCount})</h3>
        </div>
        <div className="group-info-members">
          {shown.map((m) => (
            <span key={m.id} title={m.displayName}>
              <Avatar name={m.displayName} userId={m.id} role={roleOf(members.data ?? [], m.id)} />
            </span>
          ))}
          <button type="button" className="group-info-more" aria-label="Xem tất cả thành viên" onClick={onManage}>
            …
          </button>
        </div>
      </section>

      {(['image', 'file', 'link'] as const).map((kind) => (
        <MediaSection key={kind} roomId={room.id} kind={kind} full={false} onShowAll={() => setView(kind)} />
      ))}

      <div className="group-info-actions">
        <button type="button" className="group-info-action" onClick={onManage}>
          <span aria-hidden="true">⚙️</span> Quản lý nhóm
        </button>
        {room.type === 'channel' && (
          <button type="button" className="group-info-action group-info-action--danger" onClick={onLeave}>
            <span aria-hidden="true">↪</span> Rời nhóm
          </button>
        )}
      </div>
    </Modal>
  )
}
