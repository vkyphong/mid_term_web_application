import { useEffect, useRef, useState } from 'react'
import { useDebounced } from '../../../lib/useDebounced'
import { describeChatError } from '../errors'
import { useMessageSearch } from '../hooks'
import type { Message } from '../types'
import { Avatar } from './Avatar'
import { SearchIcon } from './icons'

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Tô từ khoá trong kết quả (bỏ qua dấu và hoa thường); vẫn render dạng text. */
function Highlight({ text, query }: { text: string; query: string }) {
  // NFD + bỏ dấu giữ nguyên số ký tự gốc với chữ tiếng Việt dựng sẵn, nên vị trí khớp dùng lại được.
  const folded = [...text].map((ch) => fold(ch)).join('')
  const q = fold(query.trim())
  const index = q ? folded.indexOf(q) : -1
  if (index < 0 || folded.length !== text.length) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  )
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })

interface MessageSearchBarProps {
  roomId: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPick: (message: Message) => void
}

/**
 * Tìm tin cũ trong phòng (nhóm hoặc 1:1): bấm 🔍 thì ô tìm mở ra ngay cạnh icon ở đầu phòng,
 * kết quả xổ xuống bên dưới; chọn kết quả để nhảy tới tin đó.
 */
export function MessageSearchBar({ roomId, open, onOpen, onClose, onPick }: MessageSearchBarProps) {
  const [value, setValue] = useState('')
  const query = useDebounced(value.trim(), 300)
  const search = useMessageSearch(roomId, open ? query : '')
  const results = search.data?.pages.flatMap((p) => p.messages) ?? []
  const root = useRef<HTMLDivElement>(null)

  // Bấm ra ngoài hoặc Escape thì đóng.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) {
    return (
      <button type="button" className="icon-btn room-search-btn" aria-label="Tìm tin nhắn" title="Tìm tin nhắn" onClick={onOpen}>
        <SearchIcon />
      </button>
    )
  }

  return (
    <div className="room-search" ref={root} role="search" aria-label="Tìm tin nhắn">
      <div className="room-search-field">
        <SearchIcon />
        <input
          type="search"
          aria-label="Từ khoá"
          placeholder="Tìm tin nhắn"
          autoFocus
          maxLength={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="icon-btn" aria-label="Đóng tìm kiếm" onClick={onClose}>
          ×
        </button>
      </div>
      {query && (
        <div className="room-search-results">
          {search.error && <p className="field-error small">{describeChatError(search.error)}</p>}
          {search.isPending && <p className="muted small">Đang tìm…</p>}
          {search.isSuccess && results.length === 0 && <p className="muted small">Không có tin nào khớp với “{query}”.</p>}
          {results.length > 0 && (
            <p className="muted small">
              {results.length}
              {search.hasNextPage ? '+' : ''} kết quả, mới nhất trước
            </p>
          )}
          <ul className="user-results search-results">
            {results.map((m) => (
              <li key={m.id}>
                <button type="button" className="user-result search-result" onClick={() => onPick(m)}>
                  <Avatar name={m.sender.displayName} userId={m.sender.id} size="sm" />
                  <span>
                    <span className="search-result-meta">
                      <strong>{m.sender.displayName}</strong>
                      <time className="muted small" dateTime={m.createdAt}>
                        {when(m.createdAt)}
                      </time>
                    </span>
                    <span className="search-result-text">
                      <Highlight text={m.content} query={query} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {search.hasNextPage && (
            <button type="button" className="btn-secondary" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>
              {search.isFetchingNextPage ? 'Đang tải…' : 'Xem thêm kết quả'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
