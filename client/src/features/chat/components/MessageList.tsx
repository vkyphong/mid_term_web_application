import { useEffect, useLayoutEffect, useRef } from 'react'
import { describeChatError } from '../errors'
import type { ChatMessage } from '../types'
import { Avatar } from './Avatar'

interface HistoryProps {
  hasMore: boolean
  isLoading: boolean
  error: unknown
  onLoadOlder: () => void
}

interface MessageListProps {
  messages: ChatMessage[] | undefined
  isPending: boolean
  error: unknown
  currentUserId: string
  onRetry: (message: ChatMessage) => void
  history?: HistoryProps
}

/** Cách mép trên bao nhiêu px thì tự tải trang cũ hơn. */
const LOAD_OLDER_THRESHOLD_PX = 120

const GROUP_WINDOW_MS = 5 * 60 * 1000

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

/** Tin liền nhau của cùng người trong 5 phút thì gộp, không lặp tên. */
function startsGroup(prev: ChatMessage | undefined, m: ChatMessage) {
  return !prev || prev.sender.id !== m.sender.id || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_WINDOW_MS
}

export function MessageList({ messages, isPending, error, currentUserId, onRetry, history }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const previous = useRef<{ firstId?: string; height: number }>({ height: 0 })
  const historyRef = useRef(history)
  historyRef.current = history

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const firstId = messages?.[0]?.id
    const prepended = previous.current.firstId !== undefined && firstId !== previous.current.firstId
    if (stickToBottom.current) {
      // Đang ở gần cuối → bám theo tin mới.
      el.scrollTop = el.scrollHeight
    } else if (prepended) {
      // Vừa chèn tin cũ lên trên → giữ nguyên đoạn đang đọc, không nhảy màn hình.
      el.scrollTop += el.scrollHeight - previous.current.height
    }
    previous.current = { firstId, height: el.scrollHeight }
  }, [messages])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      const h = historyRef.current
      if (h?.hasMore && !h.isLoading && !h.error && el.scrollTop < LOAD_OLDER_THRESHOLD_PX) h.onLoadOlder()
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const showHistoryEnd = history && !history.hasMore && !isPending && (messages?.length ?? 0) > 0

  return (
    <div className="message-scroller" ref={scroller}>
      {history?.hasMore && (
        <div className="history-loader">
          {history.error ? (
            <p className="field-error small">
              {describeChatError(history.error)}{' '}
              <button type="button" className="link-btn" onClick={history.onLoadOlder}>
                Thử lại
              </button>
            </p>
          ) : (
            <button type="button" className="link-btn" disabled={history.isLoading} onClick={history.onLoadOlder}>
              {history.isLoading ? 'Đang tải tin cũ…' : 'Tải tin cũ hơn'}
            </button>
          )}
        </div>
      )}
      {showHistoryEnd && <p className="muted small center">Đã hiển thị toàn bộ lịch sử</p>}
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
