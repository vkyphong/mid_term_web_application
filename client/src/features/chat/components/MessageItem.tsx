import { useState, type KeyboardEvent } from 'react'
import { splitMentions } from '../mentions'
import { MAX_CONTENT_BYTES, contentBytes } from '../messages'
import { REACTION_EMOJIS, type ChatMessage, type UserSummary } from '../types'
import { AttachmentView } from './AttachmentView'
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
  receipt: { label: string; detail: string } | null
  showReceipt: boolean
  trackSeen: boolean
  onRetry: (message: ChatMessage) => void
  actions?: MessageActionsApi
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

/** F09: tô "@Tên"; nội dung luôn render dạng text (React tự escape), không dùng HTML (F11). */
function MessageText({ content, members, selfId }: { content: string; members: readonly UserSummary[]; selfId: string }) {
  return (
    <>
      {splitMentions(content, members).map((part, i) =>
        part.mention ? (
          <span key={i} className={`mention${part.mention.id === selfId ? ' mention--me' : ''}`}>
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
function groupReactions(message: ChatMessage, selfId: string) {
  const groups = new Map<string, { count: number; mine: boolean }>()
  for (const r of message.reactions ?? []) {
    const g = groups.get(r.emoji) ?? { count: 0, mine: false }
    g.count++
    if (r.userId === selfId) g.mine = true
    groups.set(r.emoji, g)
  }
  return [...groups.entries()]
}

export function MessageItem(props: MessageItemProps) {
  const { message: m, own, head, selfId, members, receipt, showReceipt, trackSeen, onRetry, actions } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const deleted = Boolean(m.deletedAt)
  const stored = !m.status
  const canAct = Boolean(actions) && stored && !deleted
  const reactions = deleted ? [] : groupReactions(m, selfId)
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

  return (
    <li
      className={`message${own ? ' message--own' : ''}${head ? ' message--head' : ''}${deleted ? ' message--deleted' : ''}`}
      data-message-id={trackSeen ? m.id : undefined}
    >
      {/* Tin của mình: bong bóng bên phải, không avatar. Tin người khác: bên trái kèm avatar. */}
      {!own && <div className="message-gutter">{head && <Avatar name={m.sender.displayName} />}</div>}
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
                <MessageText content={m.content} members={members} selfId={selfId} />
                {m.editedAt && <span className="message-edited"> (đã sửa)</span>}
              </p>
            )
          )}

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

        {!deleted && m.attachment && <AttachmentView attachment={m.attachment} pending={!stored} />}

        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map(([emoji, g]) => (
              <button
                key={emoji}
                type="button"
                className={`reaction-chip${g.mine ? ' reaction-chip--mine' : ''}`}
                aria-pressed={g.mine}
                aria-label={`${emoji} ${g.count}${g.mine ? ', bạn đã thả' : ''}`}
                disabled={!canAct}
                onClick={() => toggleReaction(emoji, g.mine)}
              >
                {emoji} {g.count}
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
