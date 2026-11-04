import { useMemo, useState } from 'react'
import { useDebounced } from '../../../lib/useDebounced'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { chatApi } from '../chatApi'
import { describeChatError } from '../errors'
import { useForwardMessage, useRooms, useUserSearch } from '../hooks'
import { compareTimestamps } from '../messages'
import { pushToast } from '../notifications'
import { fileKind } from '../uploads'
import type { ChatMessage, Room } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { RoomAvatar } from './RoomAvatar'

type Tab = 'recent' | 'groups' | 'people'
const MAX_TARGETS = 20
const FILE_ICONS = { image: '🖼️', pdf: '📕', word: '📘', excel: '📗', powerpoint: '📙', archive: '🗜️', text: '📄' } as const

/** Mục được chọn: phòng có sẵn, hoặc đồng nghiệp chưa có tin nhắn riêng (mở DM khi chia sẻ). */
type Target = { kind: 'room'; room: Room } | { kind: 'user'; id: string; name: string }
const keyOf = (t: Target) => (t.kind === 'room' ? t.room.id : `user:${t.id}`)

/**
 * "Chia sẻ" như Zalo: chọn nhiều nhóm / người (tìm kiếm, Gần đây / Nhóm trò chuyện / Bạn bè),
 * xem trước tin / file sẽ chuyển tiếp, kèm lời nhắn tuỳ ý.
 */
export function ForwardDialog({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const rooms = useRooms()
  const forward = useForwardMessage()
  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<Tab>('recent')
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [chosen, setChosen] = useState<Target[]>([])
  const [error, setError] = useState<string>()
  const query = useDebounced(search.trim())
  const people = useUserSearch(query, tab === 'people')

  const joined = useMemo(
    () => (rooms.data ?? []).filter((r) => (r.type === 'dm' || r.joined) && !r.archived),
    [rooms.data],
  )
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const match = (name: string) => !query || fold(name).includes(fold(query))
  const list: Target[] =
    tab === 'people'
      ? (people.data ?? []).map((u) => {
          const dm = joined.find((r) => r.type === 'dm' && r.peer?.id === u.id)
          return dm ? { kind: 'room' as const, room: dm } : { kind: 'user' as const, id: u.id, name: u.displayName }
        })
      : joined
          .filter((r) => (tab === 'groups' ? r.type === 'channel' : true) && match(r.name))
          .sort((a, b) => compareTimestamps(b.lastMessageAt ?? '', a.lastMessageAt ?? ''))
          .map((room) => ({ kind: 'room' as const, room }))

  const isChosen = (t: Target) => chosen.some((c) => keyOf(c) === keyOf(t))
  const toggle = (t: Target) => {
    setError(undefined)
    if (isChosen(t)) setChosen((list) => list.filter((c) => keyOf(c) !== keyOf(t)))
    else if (chosen.length < MAX_TARGETS) setChosen((list) => [...list, t])
    else setError(`Chỉ chia sẻ tối đa ${MAX_TARGETS} cuộc trò chuyện một lần.`)
  }

  const busy = submitting
  const submit = async () => {
    setError(undefined)
    setSubmitting(true)
    try {
      // Đồng nghiệp chưa có tin nhắn riêng → mở DM trước để lấy roomId.
      const roomIds: string[] = []
      for (const t of chosen) roomIds.push(t.kind === 'room' ? t.room.id : (await chatApi.openDm(t.id)).id)
      await forward.mutateAsync({ messageId: message.id, roomIds, note: note.trim() || undefined })
      pushToast({ id: `forward-${message.id}-${Date.now()}`, title: 'Đã chia sẻ', body: `Đã gửi tới ${roomIds.length} cuộc trò chuyện.` })
      onClose()
    } catch (err) {
      setError(describeChatError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const a = message.attachment
  return (
    <Modal title="Chia sẻ" onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      <TextField label="Tìm kiếm" name="forward-search" type="search" placeholder="Tìm nhóm hoặc người" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="forward-tabs" role="tablist" aria-label="Danh sách">
        {(
          [
            ['recent', 'Gần đây'],
            ['groups', 'Nhóm trò chuyện'],
            ['people', 'Bạn bè'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <ul className="user-results forward-list">
        {list.map((t) => (
          <li key={keyOf(t)}>
            <label className="user-result member-option">
              <input type="checkbox" checked={isChosen(t)} onChange={() => toggle(t)} disabled={busy} />
              {t.kind === 'room' ? <RoomAvatar room={t.room} /> : <Avatar name={t.name} userId={t.id} />}
              <span>
                <strong>{t.kind === 'room' ? t.room.name : t.name}</strong>
                {t.kind === 'room' && t.room.type === 'channel' && <span className="muted small">{t.room.memberCount} thành viên</span>}
              </span>
            </label>
          </li>
        ))}
        {tab === 'people' && people.isPending && <li className="muted small">Đang tìm…</li>}
        {list.length === 0 && !(tab === 'people' && people.isPending) && <li className="muted small">Không có cuộc trò chuyện phù hợp.</li>}
      </ul>

      <div className="forward-preview" aria-label="Nội dung chia sẻ">
        {a ? (
          <>
            <span className="forward-preview-icon" aria-hidden="true">{FILE_ICONS[fileKind(a.filename, a.mediaType)]}</span>
            <span>
              <strong>{a.mediaType.startsWith('image/') ? 'Chia sẻ ảnh' : 'Chia sẻ file'}</strong>
              <span className="muted small">{a.filename}</span>
            </span>
          </>
        ) : (
          <span>
            <strong>Chia sẻ tin nhắn</strong>
            <span className="muted small forward-preview-text">{message.content}</span>
          </span>
        )}
      </div>
      <TextField label="Lời nhắn (không bắt buộc)" name="forward-note" placeholder="Nhập tin nhắn…" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="dialog-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Huỷ
        </button>
        <button type="button" className="btn-primary" disabled={chosen.length === 0 || busy} onClick={() => void submit()}>
          {busy ? 'Đang chia sẻ…' : chosen.length > 0 ? `Chia sẻ (${chosen.length})` : 'Chia sẻ'}
        </button>
      </div>
    </Modal>
  )
}
