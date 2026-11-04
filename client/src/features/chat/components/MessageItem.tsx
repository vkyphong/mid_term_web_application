import { useState, type KeyboardEvent } from 'react'
import { MENTION_ALL, splitMentions } from '../mentions'
import { MAX_CONTENT_BYTES, contentBytes } from '../messages'
import { REACTION_EMOJIS, type ChatMessage, type UserSummary } from '../types'
import { roleOf } from '../roles'
import { openProfile } from '../profileViewer'
import { AttachmentView } from './AttachmentView'
import { PollCard } from './Polls'
import { Avatar } from './Avatar'

export interface MessageActionsApi {
  edit: (messageId: string, content: string) => Promise<boolean>
  remove: (messageId: string) => Promise<boolean>
  react: (messageId: string, emoji: string, active: boolean) => Promise<boolean>
}

interface MessageItemProps {
  message: ChatMessage
  own: boolean
  head: boolean
  selfId: string
  members: readonly UserSummary[]
  /** Kênh: tô "@All" (nhắc cả nhóm). */
  mentionAll?: boolean
  /** Vừa nhảy tới từ kết quả tìm kiếm: tô sáng một lúc. */
  highlight?: boolean
  /** Dòng hoạt động "Xem": nhảy tới tin bình chọn. */
  onOpenMessage?: (messageId: string) => void
  receipt: { label: string; detail: string } | null
  showReceipt: boolean
  trackSeen: boolean
  onRetry: (message: ChatMessage) => void
  actions?: MessageActionsApi
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

/** F09: tô "@Tên"; nội dung luôn render dạng text (React tự escape), không dùng HTML (F11). */
function MessageText(props: { content: string; members: readonly UserSummary[]; selfId: string; mentionAll?: boolean }) {
  const { content, members, selfId, mentionAll } = props
  return (
    <>
      {splitMentions(content, members, mentionAll).map((part, i) =>
        part.mention ? (
          <span
            key={i}
            className={`mention${part.mention.id === selfId || part.mention.id === MENTION_ALL.id ? ' mention--me' : ''}`}
          >
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/** F14: gom reaction theo emoji, đánh dấu emoji mình đã thả. */
function groupReactions(message: ChatMessage, selfId: string, members: readonly UserSummary[]) {
  const groups = new Map<string, { count: number; mine: boolean; names: string[] }>()
  for (const r of message.reactions ?? []) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false, names: [] }
    g.count++
    if (r.userId === selfId) g.mine = true
    // Ai đã thả: "Bạn" đứng đầu, người khác theo tên thành viên (người đã rời nhóm: "Ai đó").
    if (r.userId === selfId) g.names.unshift('Bạn')
    else g.names.push(members.find((u) => u.id === r.userId)?.displayName ?? (r.userId === message.sender.id ? message.sender.displayName : 'Ai đó'))
    groups.set(r.emoji, g)
  }
  return [...groups.entries()]
}

export function MessageItem(props: MessageItemProps) {
  const { message: m, own, head, selfId, members, mentionAll, highlight, onOpenMessage, receipt, showReceipt, trackSeen, onRetry, actions } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const deleted = Boolean(m.deletedAt)
  const stored = !m.status
  const canAct = Boolean(actions) && stored && !deleted
  const reactions = deleted ? [] : groupReactions(m, selfId, members)
  const draftTooLong = contentBytes(draft.trim()) > MAX_CONTENT_BYTES

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    const ok = await fn()
    setBusy(false)
    return ok
  }

  const saveEdit = async () => {
    const text = draft.trim()
    if (!text || draftTooLong || !actions) return
    if (text === m.content) return setEditing(false)
    if (await run(() => actions.edit(m.id, text))) setEditing(false)
  }

  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') setEditing(false)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void saveEdit()
    }
  }

  const toggleReaction = (emoji: string, mine: boolean) => {
    setPicker(false)
    if (actions) void actions.react(m.id, emoji, !mine)
  }

  // Dòng hoạt động bình chọn (tin hệ thống) như Zalo: "X đã bình chọn: <câu hỏi>  Xem".
  if (m.activity) {
    const verb = { vote: 'đã bình chọn', change: 'đổi lựa chọn trong cuộc bình chọn', unvote: 'bỏ bình chọn', close: 'đã khoá bình chọn', reopen: 'đã mở lại bình chọn' }[m.activity.type]
    const target = m.activity.pollMessageId
    return (
      <li className="message message--activity" id={`message-${m.id}`}>
        <p className="activity-line">
          <span className="activity-icon" aria-hidden="true">📊</span>
          <strong>{own ? 'Bạn' : m.sender.displayName}</strong> {verb}: <strong>{m.content}</strong>
          {target && onOpenMessage && (
            <button type="button" className="link-btn activity-open" onClick={() => onOpenMessage(target)}>
              Xem
            </button>
          )}
        </p>
      </li>
    )
  }

  // Bình chọn: nằm giữa khung chat như Zalo; thành viên khác thấy tên người tạo phía trên.
  if (m.poll && !deleted) {
    return (
      <li
        className={`message message--poll${highlight ? ' message--highlight' : ''}`}
        id={`message-${m.id}`}
        data-message-id={trackSeen ? m.id : undefined}
      >
        {!own && (
          <p className="poll-caption">
            <strong>{m.sender.displayName}</strong> đã tạo cuộc bình chọn
          </p>
        )}
        <PollCard poll={m.poll} selfId={selfId} members={members} disabled={!stored} />
        <time className="poll-time" dateTime={m.createdAt}>
          {timeOf(m.createdAt)}
        </time>
      </li>
    )
  }

  return (
    <li
      className={`message${own ? ' message--own' : ''}${head ? ' message--head' : ''}${deleted ? ' message--deleted' : ''}${highlight ? ' message--highlight' : ''}`}
      id={`message-${m.id}`}
      data-message-id={trackSeen ? m.id : undefined}
    >
      {/* Tin của mình: bong bóng bên phải, không avatar. Tin người khác: bên trái kèm avatar. */}
      {!own && <div className="message-gutter">{head && (
            <button type="button" className="avatar-btn" aria-label={`Xem thông tin ${m.sender.displayName}`} onClick={() => openProfile(m.sender.id)}>
              <Avatar name={m.sender.displayName} userId={m.sender.id} role={mentionAll ? roleOf(members, m.sender.id) : undefined} />
            </button>
          )}</div>}
      <div className="message-body">
        {head && (
          <div className="message-meta">
            {own ? <span className="sr-only">Bạn</span> : <strong>{m.sender.displayName}</strong>}
            <time dateTime={m.createdAt} title={receipt?.detail}>
              {timeOf(m.createdAt)}
            </time>
          </div>
        )}

        <div className="message-row">
          {/* Chữ và file chung một khối, thanh thao tác nằm ngoài khối (tin chỉ có file cũng vậy). */}
          <div className="message-stack">
          {editing ? (
            <div className="message-edit">
              <label className="sr-only" htmlFor={`edit-${m.id}`}>
                Sửa tin nhắn
              </label>
              <textarea
                id={`edit-${m.id}`}
                value={draft}
                autoFocus
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEditKey}
                aria-invalid={draftTooLong || undefined}
              />
              <div className="message-edit-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={busy}>
                  Huỷ
                </button>
                <button type="button" className="btn-primary btn-inline" onClick={() => void saveEdit()} disabled={busy || !draft.trim() || draftTooLong}>
                  Lưu
                </button>
              </div>
            </div>
          ) : deleted ? (
            <p className="message-content message-bubble message-bubble--deleted">Tin nhắn đã bị xoá</p>
          ) : (
            (m.content || !m.attachment) && (
              <p className="message-content message-bubble">
                <MessageText content={m.content} members={members} selfId={selfId} mentionAll={mentionAll} />
                {m.editedAt && <span className="message-edited"> (đã sửa)</span>}
              </p>
            )
          )}
          {!deleted && m.attachment && <AttachmentView attachment={m.attachment} pending={!stored} />}
          </div>

          {canAct && !editing && (
            <div className="message-tools" role="toolbar" aria-label="Thao tác với tin nhắn">
              <button type="button" className="icon-btn" aria-label="Thả cảm xúc" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
                😊
              </button>
              {own && (
                <>
                  <button type="button" className="icon-btn" aria-label="Sửa tin nhắn" onClick={() => { setDraft(m.content); setEditing(true) }} disabled={!m.content}>
                    ✏️
                  </button>
                  <button type="button" className="icon-btn" aria-label="Xoá tin nhắn" onClick={() => setConfirmDelete(true)}>
                    🗑️
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {picker && canAct && (
          <div className="reaction-picker" role="group" aria-label="Chọn cảm xúc">
            {REACTION_EMOJIS.map((emoji) => {
              const mine = reactions.some(([e, g]) => e === emoji && g.mine)
              return (
                <button key={emoji} type="button" className="reaction-option" aria-label={`Thả ${emoji}`} aria-pressed={mine} onClick={() => toggleReaction(emoji, mine)}>
                  {emoji}
                </button>
              )
            })}
          </div>
        )}

        {confirmDelete && actions && (
          <div className="message-confirm" role="alertdialog" aria-label="Xác nhận xoá">
            <span>Xoá tin nhắn này?</span>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Huỷ
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={async () => { if (await run(() => actions.remove(m.id))) setConfirmDelete(false) }}
            >
              Xoá
            </button>
          </div>
        )}

        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map(([emoji, g]) => (
              <button
                key={emoji}
                type="button"
                className={`reaction-chip${g.mine ? ' reaction-chip--mine' : ''}`}
                aria-pressed={g.mine}
                aria-label={`${emoji} ${g.count}: ${g.names.join(', ')}`}
                disabled={!canAct}
                onClick={() => toggleReaction(emoji, g.mine)}
              >
                {emoji} {g.count}
                <span className="reaction-who" aria-hidden="true">
                  {g.names.join(', ')}
                </span>
              </button>
            ))}
          </div>
        )}

        {m.status === 'sending' && <span className="message-status">Đang gửi…</span>}
        {m.status === 'queued' && <span className="message-status">{m.error ?? 'Chờ kết nối để gửi…'}</span>}
        {receipt && showReceipt && (
          <span className="message-status message-receipt" title={receipt.detail}>
            {receipt.label}
          </span>
        )}
        {m.status === 'failed' && (
          <span className="message-status message-status--failed">
            Gửi lỗi{m.error ? `: ${m.error}` : ''} ·{' '}
            <button type="button" className="link-btn" onClick={() => onRetry(m)}>
              Thử lại
            </button>
          </span>
        )}
      </div>
    </li>
  )
}
