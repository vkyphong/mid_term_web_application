import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { SendOptions } from '../hooks'
import { MENTION_ALL, filterMentionCandidates, insertMention, mentionQueryAt, resolveMentions } from '../mentions'
import { MAX_CONTENT_BYTES, contentBytes } from '../messages'
import { ACCEPTED_LABEL, ACCEPT_ATTR, IMAGE_ACCEPT_ATTR, MAX_UPLOAD_LABEL, formatBytes, useFileUpload } from '../uploads'
import type { RoomMember, UserSummary } from '../types'
import { Avatar } from './Avatar'
import { AtIcon, ImageIcon, PaperclipIcon, SmileIcon, ThumbsUpIcon, UserPlusIcon } from './icons'

interface ComposerProps {
  roomId: string
  placeholder: string
  onSend: (content: string, options: SendOptions) => void
  /** Khoá khi lịch sử chưa tải xong, để tin tạm không bị mất. */
  disabled?: boolean
  /** F07: gọi mỗi lần nội dung thay đổi (để báo "đang gõ"). */
  onInput?: (value: string) => void
  /** F09: thành viên phòng để gợi ý @mention. */
  members?: readonly RoomMember[]
  selfId?: string
  /** Kênh: cho phép "@All" nhắc cả nhóm. */
  allowMentionAll?: boolean
  /** Kênh: nút "Thêm thành viên" trên thanh công cụ. */
  onAddMembers?: () => void
}

/** Emoji hay dùng; chèn vào vị trí con trỏ. */
const QUICK_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅',
  '😢', '😭', '😡', '😮', '😴', '🥳', '👍', '👎', '👏', '🙏',
  '💪', '👌', '✌️', '🤝', '❤️', '💔', '🔥', '🎉', '✅', '❌',
  '⭐', '💯', '☕', '🍀', '🌹', '🎂', '📌', '💡', '⏰', '🚀',
]

const QUICK_REACTION = '👍'

function ToolButton(props: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  const { label, onClick, disabled, pressed, children } = props
  return (
    <button
      type="button"
      className="composer-tool"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      // Giữ focus trong ô soạn tin để chèn emoji / "@" đúng vị trí con trỏ.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function Composer(props: ComposerProps) {
  const { roomId, placeholder, onSend, disabled = false, onInput, members = [], selfId, allowMentionAll = false, onAddMembers } = props
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState<UserSummary[]>([])
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const emojiArea = useRef<HTMLDivElement>(null)
  const upload = useFileUpload(roomId)
  // Vị trí con trỏ cần đặt sau khi chèn @mention / emoji: đặt ngay sau commit (không chờ frame sau),
  // để phím gõ tiếp theo không chèn nhầm chỗ.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = textarea.current
    if (pendingCaret.current === null || !el) return
    el.focus()
    el.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  // Bấm ra ngoài bảng emoji thì đóng.
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: MouseEvent) => {
      if (!emojiArea.current?.contains(e.target as Node)) setEmojiOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [emojiOpen])

  const trimmed = value.trim()
  const bytes = contentBytes(trimmed)
  const tooLong = bytes > MAX_CONTENT_BYTES
  const uploading = upload.state.status === 'uploading'
  const ready = upload.state.status === 'done' ? upload.state.upload : undefined
  const canSend = !disabled && !tooLong && !uploading && upload.state.status !== 'error' && (Boolean(trimmed) || Boolean(ready))
  const idle = !trimmed && upload.state.status === 'idle'
  const candidates = mention ? filterMentionCandidates(members, mention.query, selfId, allowMentionAll) : []
  const othersCount = members.filter((m) => m.id !== selfId && m.enabled !== false).length

  const updateMention = (text: string, caret: number) => {
    const next = mentionQueryAt(text, caret)
    setMention(next)
    setHighlight(0)
  }

  const changeValue = (text: string, caret?: number) => {
    setValue(text)
    onInput?.(text)
    if (caret !== undefined) pendingCaret.current = caret
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    changeValue(e.target.value)
    updateMention(e.target.value, e.target.selectionStart)
  }

  /** Chèn đoạn text vào vị trí con trỏ (thay vùng đang chọn). */
  const insertAtCaret = (text: string) => {
    const el = textarea.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = value.slice(0, start) + text + value.slice(end)
    const caret = start + text.length
    changeValue(next, caret)
    return { next, caret }
  }

  const startMention = () => {
    const start = textarea.current?.selectionStart ?? value.length
    const needsSpace = start > 0 && !/\s/.test(value[start - 1])
    const { next, caret } = insertAtCaret(needsSpace ? ' @' : '@')
    updateMention(next, caret)
  }

  const choose = (member: UserSummary) => {
    if (!mention) return
    const caret = textarea.current?.selectionStart ?? value.length
    const next = insertMention(value, mention.start, caret, member)
    changeValue(next.text, next.caret)
    setPicked((list) => (list.some((m) => m.id === member.id) ? list : [...list, member]))
    setMention(null)
  }

  const reset = () => {
    setValue('')
    setPicked([])
    setMention(null)
    setEmojiOpen(false)
    upload.clear()
  }

  const submit = () => {
    if (!canSend) return
    onSend(trimmed, { mentions: resolveMentions(trimmed, picked, members, selfId), upload: ready })
    reset()
  }

  /** Giống Zalo: ô trống thì nút gửi là 👍, bấm để gửi nhanh. */
  const sendQuickReaction = () => {
    if (disabled) return
    onSend(QUICK_REACTION, {})
    setEmojiOpen(false)
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
    if (e.key === 'Escape' && emojiOpen) {
      setEmojiOpen(false)
      return
    }
    // Enter gửi, Shift+Enter xuống dòng (bỏ qua khi đang gõ tiếng Việt bằng IME).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const onPickFile = (imagesOnly: boolean) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // cho phép chọn lại cùng một file
    if (file) upload.start(file, imagesOnly)
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
                {m.id === MENTION_ALL.id ? (
                  <>
                    <span className="mention-all-badge" aria-hidden="true">@</span>
                    <span>
                      <strong>@All</strong>
                      <span className="muted small"> Báo cho cả nhóm ({othersCount} người)</span>
                    </span>
                  </>
                ) : (
                  <>
                    <Avatar name={m.displayName} size="sm" />
                    {m.displayName}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="composer-toolbar" role="toolbar" aria-label="Công cụ soạn tin" ref={emojiArea}>
        <ToolButton label="Biểu tượng cảm xúc" pressed={emojiOpen} disabled={disabled} onClick={() => setEmojiOpen((o) => !o)}>
          <SmileIcon />
        </ToolButton>
        <ToolButton label="Gửi hình ảnh" disabled={disabled || uploading} onClick={() => imageInput.current?.click()}>
          <ImageIcon />
        </ToolButton>
        <ToolButton label="Đính kèm tệp" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
          <PaperclipIcon />
        </ToolButton>
        <ToolButton label="Nhắc tên thành viên" disabled={disabled} onClick={startMention}>
          <AtIcon />
        </ToolButton>
        {onAddMembers && (
          <ToolButton label="Thêm thành viên" disabled={disabled} onClick={onAddMembers}>
            <UserPlusIcon />
          </ToolButton>
        )}
        <span className="composer-hint muted small">Tệp: {ACCEPTED_LABEL}, tối đa {MAX_UPLOAD_LABEL}</span>

        {emojiOpen && (
          <div className="emoji-panel" role="group" aria-label="Chọn biểu tượng cảm xúc">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-option"
                aria-label={`Chèn ${emoji}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertAtCaret(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT_ATTR} hidden onChange={onPickFile(true)} data-testid="image-input" />
      <input ref={fileInput} type="file" accept={ACCEPT_ATTR} hidden onChange={onPickFile(false)} data-testid="file-input" />

      <div className="composer-row">
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
        {idle ? (
          <button
            type="button"
            className="composer-quick"
            aria-label={`Gửi nhanh ${QUICK_REACTION}`}
            title={`Gửi nhanh ${QUICK_REACTION}`}
            disabled={disabled}
            onClick={sendQuickReaction}
          >
            <ThumbsUpIcon />
          </button>
        ) : (
          <button type="submit" className="btn-primary composer-send" disabled={!canSend}>
            Gửi
          </button>
        )}
      </div>
      {bytes > MAX_CONTENT_BYTES * 0.8 && (
        <p className={`composer-count${tooLong ? ' field-error' : ''}`}>
          {bytes}/{MAX_CONTENT_BYTES} byte
        </p>
      )}
    </form>
  )
}
