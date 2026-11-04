import { useState } from 'react'
import { useDebounced } from '../../../lib/useDebounced'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useMessageSearch } from '../hooks'
import type { Message } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

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

/** Tìm tin cũ trong phòng (nhóm hoặc 1:1); chọn kết quả để nhảy tới tin đó. */
export function MessageSearchDialog(props: { roomId: string; onClose: () => void; onPick: (message: Message) => void }) {
  const { roomId, onClose, onPick } = props
  const [value, setValue] = useState('')
  const query = useDebounced(value.trim(), 300)
  const search = useMessageSearch(roomId, query)
  const results = search.data?.pages.flatMap((p) => p.messages) ?? []

  return (
    <Modal title="Tìm tin nhắn" onClose={onClose}>
      <TextField
        label="Từ khoá"
        name="q"
        type="search"
        placeholder="Nhập từ cần tìm"
        autoFocus
        maxLength={100}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {search.error && <p className="field-error">{describeChatError(search.error)}</p>}
      {query && search.isPending && <p className="muted small">Đang tìm…</p>}
      {query && search.isSuccess && results.length === 0 && <p className="muted small">Không có tin nào khớp với “{query}”.</p>}
      {results.length > 0 && <p className="muted small">{results.length}{search.hasNextPage ? '+' : ''} kết quả, mới nhất trước</p>}
      <ul className="user-results search-results">
        {results.map((m) => (
          <li key={m.id}>
            <button type="button" className="user-result search-result" onClick={() => onPick(m)}>
              <Avatar name={m.sender.displayName} userId={m.sender.id} size="sm" />
              <span>
                <span className="search-result-meta">
                  <strong>{m.sender.displayName}</strong>
                  <time className="muted small" dateTime={m.createdAt}>{when(m.createdAt)}</time>
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
    </Modal>
  )
}
