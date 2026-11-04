import { Fragment, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { describeChatError } from '../errors'
import { describeReceipt, markSeen, needsReceipt } from '../receipts'
import type { ChatMessage, RoomType, UserSummary } from '../types'
import { MessageItem, type MessageActionsApi } from './MessageItem'

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
  /** F09: thành viên phòng, để tô "@Tên". */
  members?: readonly UserSummary[]
  /** F14: sửa / xoá / thả cảm xúc. */
  actions?: MessageActionsApi
  /** Tin cần cuộn tới và tô sáng (từ kết quả tìm kiếm). */
  focusMessageId?: string | null
  /** Nhảy tới một tin (dòng hoạt động bình chọn → tin bình chọn). */
  onOpenMessage?: (messageId: string) => void
  onReply?: (message: ChatMessage) => void
  onForward?: (message: ChatMessage) => void
}

const NO_MEMBERS: readonly UserSummary[] = []

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


const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const dayKey = (iso: string) => new Date(iso).toDateString()

/** Chip ngày giữa khung chat như Zalo: "T7 31/10/2026"; hôm nay / hôm qua ghi chữ. */
function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Hôm nay'
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Tin liền nhau của cùng người trong 5 phút thì gộp, không lặp tên. */
function startsGroup(prev: ChatMessage | undefined, m: ChatMessage) {
  // Bình chọn nằm giữa khung, nên tin ngay sau nó bắt đầu nhóm mới (hiện lại tên + avatar).
  if (!prev || prev.poll || m.poll || prev.activity || m.activity || dayKey(prev.createdAt) !== dayKey(m.createdAt)) return true
  return prev.sender.id !== m.sender.id || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > GROUP_WINDOW_MS
}

export function MessageList({
  messages,
  isPending,
  error,
  currentUserId,
  onRetry,
  history,
  roomType = 'channel',
  members = NO_MEMBERS,
  actions,
  focusMessageId,
  onOpenMessage,
  onReply,
  onForward,
}: MessageListProps) {
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

  // Nhảy tới tin từ kết quả tìm kiếm: cuộn tới giữa khung, ngừng bám cuối danh sách.
  useLayoutEffect(() => {
    if (!focusMessageId) return
    const target = document.getElementById(`message-${focusMessageId}`)
    if (!target) return
    stickToBottom.current = false
    target.scrollIntoView?.({ block: 'center' })
  }, [focusMessageId, messages])

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
          const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt)
          return (
            <Fragment key={m.id}>
            {newDay && (
              <li className="day-separator" role="separator">
                <span>{formatDay(m.createdAt)}</span>
              </li>
            )}
            <MessageItem
              key={m.id}
              message={m}
              own={own}
              head={startsGroup(messages[i - 1], m)}
              selfId={currentUserId}
              members={members}
              mentionAll={roomType === 'channel'}
              highlight={m.id === focusMessageId}
              onOpenMessage={onOpenMessage}
              receipt={own && !m.status ? describeReceipt(m, roomType) : null}
              showReceipt={m.id === lastOwnId}
              trackSeen={needsReceipt(m, 'seen', currentUserId)}
              onRetry={onRetry}
              actions={actions}
              onReply={onReply}
              onForward={m.content || m.attachment ? onForward : undefined}
            />
            </Fragment>
          )
        })}
      </ol>
    </div>
  )
}
