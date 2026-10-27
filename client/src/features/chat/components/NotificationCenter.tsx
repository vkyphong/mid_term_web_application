import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { chatApi } from '../chatApi'
import { chatKeys } from '../hooks'
import {
  describeNotification,
  dismissToast,
  pushToast,
  useMarkNotificationRead,
  useNotifications,
  useToasts,
  type Toast,
} from '../notifications'
import type { Notification, Room } from '../types'

const timeAgo = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

/**
 * Mở hội thoại của thông báo: chỉ đi tới khi mình vẫn còn trong phòng (contract F09);
 * thông báo hệ thống (F12) không có phòng.
 */
function useOpenNotification() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const markRead = useMarkNotificationRead()
  return async (n: Pick<Notification, 'id' | 'roomId' | 'readAt'>) => {
    if (!n.readAt) markRead.mutate(n.id)
    if (!n.roomId) return
    const find = (rooms: Room[] | undefined) => rooms?.find((r) => r.id === n.roomId)
    // Phòng mới (vd DM vừa được tạo) có thể chưa có trong cache → tải lại danh sách trước khi kết luận.
    let room = find(queryClient.getQueryData<Room[]>(chatKeys.rooms))
    if (!room) {
      // Gọi thẳng REST thay vì refetch qua cache: refetch có thể bị huỷ khi message:new của chính
      // phòng mới đó làm danh sách phòng tải lại cùng lúc.
      const rooms = await chatApi.listRooms().catch(() => undefined)
      if (rooms) queryClient.setQueryData<Room[]>(chatKeys.rooms, rooms)
      room = find(rooms)
    }
    if (room && (room.joined || room.type === 'dm')) navigate(`/rooms/${n.roomId}`)
    else pushToast({ id: `no-access-${n.id}`, title: 'Không mở được', body: 'Bạn không còn trong phòng này.', tone: 'error' })
  }
}

export function NotificationBell() {
  const notifications = useNotifications()
  const open = useOpenNotification()
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const unread = notifications.data?.unreadCount ?? 0

  useEffect(() => {
    if (!expanded) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setExpanded(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  return (
    <div className="notification-center" ref={root}>
      <button
        type="button"
        className="icon-btn bell"
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        🔔
        {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {expanded && (
        <div className="notification-panel" role="region" aria-label="Danh sách thông báo">
          <h2>Thông báo</h2>
          {notifications.isPending && <p className="muted small">Đang tải…</p>}
          {notifications.data?.notifications.length === 0 && <p className="muted small">Chưa có thông báo.</p>}
          <ul>
            {notifications.data?.notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`notification-item${n.readAt ? '' : ' notification-item--unread'}`}
                  onClick={() => { void open(n); setExpanded(false) }}
                >
                  <span className="notification-title">{describeNotification(n)}</span>
                  <span className="notification-content">{n.content || '(tệp đính kèm)'}</span>
                  <time className="muted small" dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ToastHost() {
  const toasts = useToasts()
  const open = useOpenNotification()
  const click = (t: Toast) => {
    dismissToast(t.id)
    if (t.notificationId) void open({ id: t.notificationId, roomId: t.roomId, readAt: null })
  }
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'error' ? ' toast--error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <button type="button" className="toast-body" onClick={() => click(t)}>
            <strong>{t.title}</strong>
            <span>{t.body || '(tệp đính kèm)'}</span>
          </button>
          <button type="button" className="icon-btn" aria-label="Đóng thông báo" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
