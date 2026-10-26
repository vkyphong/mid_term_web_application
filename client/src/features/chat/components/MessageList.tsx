import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { describeChatError } from '../errors'
import { describeReceipt, markSeen, needsReceipt } from '../receipts'
import type { ChatMessage, RoomType } from '../types'
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
  /** F08: loại phòng để hiển thị trạng thái đã nhận/đã xem. */
  roomType?: RoomType
}

/** Tỉ lệ diện tích tin phải nằm trong khung nhìn mới coi là "đã xem". */
const SEEN_VISIBLE_RATIO = 0.6

/**
 * F08: gửi "seen" chỉ khi tab đang hiển thị và tin nằm trong vùng nhìn thấy của khung chat.
 * Phòng chưa mở thì tin không được render nên không bao giờ bị đánh dấu.
 */
function useSeenTracker(root: RefObject<HTMLDivElement | null>, messages: ChatMessage[] | undefined, selfId: string) {
  const visible = useRef(new Set<string>())
  const byId = useRef(new Map<string, ChatMessage>())
  byId.current = new Map((messages ?? []).map((m) => [m.id, m]))

  useEffect(() => {
    const el = root.current
    if (!el || !selfId || typeof IntersectionObserver === 'undefined') return
    const seen = visible.current
    const flush = () => {
      if (document.visibilityState !== 'visible') return
      for (const id of seen) {
        const message = byId.current.get(id)
        if (message) markSeen(message, selfId)
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId
          if (!id) continue
          if (entry.isIntersecting) seen.add(id)
          else seen.delete(id)
        }
        flush()
      },
      { root: el, threshold: SEEN_VISIBLE_RATIO },
    )
    el.querySelectorAll<HTMLElement>('[data-message-id]').forEach((node) => observer.observe(node))
    document.addEventListener('visibilitychange', flush)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', flush)
      seen.clear()
    }
  }, [root, messages, selfId])
}

/** Cách mép trên bao nhiêu px thì tự tải trang cũ hơn. */
const LOAD_OLDER_THRESHOLD_PX = 120

const GROUP_WINDOW_MS = 5 * 60 * 1000

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

/** Tin liền nhau của cùng người trong 5 phút thì gộp, không lặp tên. */
function startsGroup(prev: ChatMessage | undefined, m: ChatMessage) {
  return !prev || prev.sender.id !== m.sender.id || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_WINDOW_MS
}

export function MessageList({ messages, isPending, error, currentUserId, onRetry, history, roomType = 'channel' }: MessageListProps) {
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

  useSeenTracker(scroller, messages, currentUserId)

  const showHistoryEnd = history && !history.hasMore && !isPending && (messages?.length ?? 0) > 0
  // Trạng thái nhận/xem chỉ hiện dưới tin đã lưu mới nhất của mình (như các app chat phổ biến).
  let lastOwnId: string | undefined
  for (const m of messages ?? []) if (m.sender.id === currentUserId && !m.status) lastOwnId = m.id

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
          const receipt = own && !m.status ? describeReceipt(m, roomType) : null
          return (
            <li
              key={m.id}
              className={`message${own ? ' message--own' : ''}${head ? ' message--head' : ''}`}
              data-message-id={needsReceipt(m, 'seen', currentUserId) ? m.id : undefined}
            >
              <div className="message-gutter">{head && <Avatar name={m.sender.displayName} />}</div>
              <div className="message-body">
                {head && (
                  <div className="message-meta">
                    <strong>{own ? 'Bạn' : m.sender.displayName}</strong>
                    <time dateTime={m.createdAt} title={receipt?.detail}>
                      {timeOf(m.createdAt)}
                    </time>
                  </div>
                )}
                <p className="message-content">{m.content}</p>
                {m.status === 'sending' && <span className="message-status">Đang gửi…</span>}
                {receipt && m.id === lastOwnId && (
                  <span className="message-status message-receipt" title={receipt.detail}>
                    {receipt.label}
                  </span>
                )}
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
