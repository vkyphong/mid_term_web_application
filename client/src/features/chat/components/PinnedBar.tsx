import { useState } from 'react'
import { usePinMessage, usePins } from '../hooks'
import type { Message } from '../types'

const snippet = (m: Message) => m.content || (m.attachment ? `[${m.attachment.mediaType.startsWith('image/') ? 'Ảnh' : 'Tệp'}] ${m.attachment.filename}` : '')

/** Thanh ghim đầu đoạn chat như Zalo: tin ghim gần nhất, bấm để nhảy tới; mở rộng để xem / bỏ ghim tất cả. */
export function PinnedBar({ roomId, onOpen }: { roomId: string; onOpen: (messageId: string) => void }) {
  const pins = usePins(roomId)
  const unpin = usePinMessage()
  const [expanded, setExpanded] = useState(false)
  const list = pins.data ?? []
  if (list.length === 0) return null
  const shown = expanded ? list : list.slice(0, 1)

  return (
    <section className="pinned-bar" aria-label="Tin nhắn đã ghim">
      <ul>
        {shown.map((m) => (
          <li key={m.id}>
            <span className="pinned-icon" aria-hidden="true">📌</span>
            <button type="button" className="pinned-open" onClick={() => onOpen(m.id)} title="Xem tin trong đoạn chat">
              <strong>{m.sender.displayName}:</strong> {snippet(m)}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Bỏ ghim tin của ${m.sender.displayName}`}
              title="Bỏ ghim"
              disabled={unpin.isPending}
              onClick={() => unpin.mutate({ messageId: m.id, pinned: false })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {list.length > 1 && (
        <button type="button" className="link-btn pinned-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Thu gọn' : `+${list.length - 1} tin ghim khác`}
        </button>
      )}
    </section>
  )
}
