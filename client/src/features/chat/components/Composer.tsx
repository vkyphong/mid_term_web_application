import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { MAX_CONTENT_BYTES, contentBytes } from '../messages'

interface ComposerProps {
  placeholder: string
  onSend: (content: string) => void
  /** Khoá khi lịch sử chưa tải xong, để tin tạm không bị mất. */
  disabled?: boolean
  /** F07: gọi mỗi lần nội dung thay đổi (để báo "đang gõ"). */
  onInput?: (value: string) => void
}

export function Composer({ placeholder, onSend, disabled = false, onInput }: ComposerProps) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  const bytes = contentBytes(trimmed)
  const tooLong = bytes > MAX_CONTENT_BYTES

  const submit = () => {
    if (!trimmed || tooLong || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  // Enter gửi, Shift+Enter xuống dòng (bỏ qua khi đang gõ tiếng Việt bằng IME).
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <label htmlFor="composer-input" className="sr-only">
        Nội dung tin nhắn
      </label>
      <textarea
        id="composer-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value)
          onInput?.(e.target.value)
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-invalid={tooLong || undefined}
      />
      <button type="submit" className="btn-primary composer-send" disabled={!trimmed || tooLong || disabled}>
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
