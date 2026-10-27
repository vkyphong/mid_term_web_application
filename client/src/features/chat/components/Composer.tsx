import { useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { SendOptions } from '../hooks'
import { filterMentionCandidates, insertMention, mentionQueryAt, resolveMentions } from '../mentions'
import { MAX_CONTENT_BYTES, contentBytes } from '../messages'
import { ACCEPT_ATTR, formatBytes, useFileUpload } from '../uploads'
import type { UserSummary } from '../types'
import { Avatar } from './Avatar'

interface ComposerProps {
  roomId: string
  placeholder: string
  onSend: (content: string, options: SendOptions) => void
  /** Khoá khi lịch sử chưa tải xong, để tin tạm không bị mất. */
  disabled?: boolean
  /** F07: gọi mỗi lần nội dung thay đổi (để báo "đang gõ"). */
  onInput?: (value: string) => void
  /** F09: thành viên phòng để gợi ý @mention. */
  members?: readonly UserSummary[]
  selfId?: string
}

export function Composer({ roomId, placeholder, onSend, disabled = false, onInput, members = [], selfId }: ComposerProps) {
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState<UserSummary[]>([])
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = useFileUpload(roomId)
  // Vị trí con trỏ cần đặt sau khi chèn @mention: đặt ngay sau commit (không chờ frame sau),
  // để phím gõ tiếp theo không chèn nhầm chỗ.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = textarea.current
    if (pendingCaret.current === null || !el) return
    el.focus()
    el.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  const trimmed = value.trim()
  const bytes = contentBytes(trimmed)
  const tooLong = bytes > MAX_CONTENT_BYTES
  const uploading = upload.state.status === 'uploading'
  const ready = upload.state.status === 'done' ? upload.state.upload : undefined
  const canSend = !disabled && !tooLong && !uploading && upload.state.status !== 'error' && (Boolean(trimmed) || Boolean(ready))
  const candidates = mention ? filterMentionCandidates(members, mention.query, selfId) : []

  const updateMention = (text: string, caret: number) => {
    const next = mentionQueryAt(text, caret)
    setMention(next)
    setHighlight(0)
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    onInput?.(e.target.value)
    updateMention(e.target.value, e.target.selectionStart)
  }

  const choose = (member: UserSummary) => {
    if (!mention) return
    const caret = textarea.current?.selectionStart ?? value.length
    const next = insertMention(value, mention.start, caret, member)
    setValue(next.text)
    setPicked((list) => (list.some((m) => m.id === member.id) ? list : [...list, member]))
    setMention(null)
    pendingCaret.current = next.caret
  }

  const submit = () => {
    if (!canSend) return
    onSend(trimmed, { mentions: resolveMentions(trimmed, picked), upload: ready })
    setValue('')
    setPicked([])
    setMention(null)
    upload.clear()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (candidates.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setHighlight((h) => (h + step + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(candidates[highlight])
        return
      }
      if (e.key === 'Escape') {
        setMention(null)
        return
      }
    }
    // Enter gửi, Shift+Enter xuống dòng (bỏ qua khi đang gõ tiếng Việt bằng IME).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng một file
    if (file) upload.start(file)
  }

  const s = upload.state
  return (
    <form className="composer" onSubmit={onSubmit}>
      {s.status !== 'idle' && (
        <div className={`upload-chip${s.status === 'error' ? ' upload-chip--error' : ''}`} role="status">
          <span aria-hidden="true">📎</span>
          <span className="upload-name">{s.file?.name ?? 'Tệp'}</span>
          {s.file && <span className="muted small">{formatBytes(s.file.size)}</span>}
          {s.status === 'uploading' && (
            <progress max={1} value={s.progress} aria-label="Tiến trình tải lên">
              {Math.round(s.progress * 100)}%
            </progress>
          )}
          {s.status === 'done' && <span className="muted small">Sẵn sàng gửi</span>}
          {s.status === 'error' && <span className="field-error small">{s.error}</span>}
          <button type="button" className="icon-btn" aria-label="Bỏ tệp đính kèm" onClick={upload.clear}>
            ×
          </button>
        </div>
      )}

      {candidates.length > 0 && (
        <ul className="mention-list" role="listbox" aria-label="Nhắc đến thành viên">
          {candidates.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === highlight}>
              <button type="button" className="mention-option" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m)}>
                <Avatar name={m.displayName} size="sm" />
                {m.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="icon-btn composer-attach"
        aria-label="Đính kèm tệp"
        title="Đính kèm ảnh JPEG/PNG hoặc PDF (tối đa 5 MB)"
        disabled={disabled || uploading}
        onClick={() => fileInput.current?.click()}
      >
        📎
      </button>
      <input ref={fileInput} type="file" accept={ACCEPT_ATTR} hidden onChange={onPickFile} data-testid="file-input" />
      <label htmlFor="composer-input" className="sr-only">
        Nội dung tin nhắn
      </label>
      <textarea
        id="composer-input"
        ref={textarea}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => setMention(null)}
        disabled={disabled}
        aria-invalid={tooLong || undefined}
        aria-autocomplete="list"
        aria-expanded={candidates.length > 0}
      />
      <button type="submit" className="btn-primary composer-send" disabled={!canSend}>
        Gửi
      </button>
      {bytes > MAX_CONTENT_BYTES * 0.8 && (
        <p className={`composer-count${tooLong ? ' field-error' : ''}`}>
          {bytes}/{MAX_CONTENT_BYTES} byte
        </p>
      )}
    </form>
  )
}
