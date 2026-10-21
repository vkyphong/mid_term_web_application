import { useEffect, useLayoutEffect, useRef } from 'react'
import { describeChatError } from '../errors'
import type { ChatMessage } from '../types'
import { Avatar } from './Avatar'

interface MessageListProps {
  messages: ChatMessage[] | undefined
  isPending: boolean
  error: unknown
  currentUserId: string
  onRetry: (message: ChatMessage) => void
}

const GROUP_WINDOW_MS = 5 * 60 * 1000

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

/** Tin liền nhau của cùng người trong 5 phút thì gộp, không lặp tên. */
function startsGroup(prev: ChatMessage | undefined, m: ChatMessage) {
  return !prev || prev.sender.id !== m.sender.id || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_WINDOW_MS
}

export function MessageList({ messages, isPending, error, currentUserId, onRetry }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Chỉ tự cuộn xuống khi người dùng đang ở gần cuối (không giật khi đang đọc tin cũ).
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="message-scroller" ref={scroller}>
      {isPending && <p className="muted center">Đang tải tin nhắn…</p>}
      {Boolean(error) && <p className="field-error center">{describeChatError(error)}</p>}
      {messages?.length === 0 && <p className="muted center">Chưa có tin nhắn. Hãy bắt đầu cuộc trò chuyện!</p>}
      <ol className="message-list" aria-label="Tin nhắn" aria-live="polite">
        {messages?.map((m, i) => {
          const own = m.sender.id === currentUserId
          const head = startsGroup(messages[i - 1], m)
          return (
            <li key={m.id} className={`message${own ? ' message--own' : ''}${head ? ' message--head' : ''}`}>
              <div className="message-gutter">{head && <Avatar name={m.sender.displayName} />}</div>
              <div className="message-body">
                {head && (
                  <div className="message-meta">
                    <strong>{own ? 'Bạn' : m.sender.displayName}</strong>
                    <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
                  </div>
                )}
                <p className="message-content">{m.content}</p>
                {m.status === 'sending' && <span className="message-status">Đang gửi…</span>}
                {m.status === 'failed' && (
                  <span className="message-status message-status--failed">
                    Gửi lỗi ·{' '}
                    <button type="button" className="link-btn" onClick={() => onRetry(m)}>
                      Thử lại
                    </button>
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
