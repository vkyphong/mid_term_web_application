import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { chatApi } from './chatApi'
import type { Notification, NotificationPage } from './types'

/** F09. Nằm dưới ['chat'] nên được tải lại sau reconnect (lỡ event khi offline). */
export const notificationsKey = ['chat', 'notifications'] as const

export function useNotifications() {
  return useQuery({ queryKey: notificationsKey, queryFn: () => chatApi.listNotifications(), staleTime: Infinity })
}

/** notification:new → thêm vào đầu danh sách (bỏ qua nếu đã có, vd event trùng). Trả về true nếu là thông báo mới. */
export function applyNotification(queryClient: QueryClient, notification: Notification): boolean {
  let added = false
  queryClient.setQueryData<NotificationPage>(notificationsKey, (page) => {
    if (!page || page.notifications.some((n) => n.id === notification.id)) return page
    added = true
    return {
      ...page,
      notifications: [notification, ...page.notifications],
      unreadCount: page.unreadCount + (notification.readAt ? 0 : 1),
    }
  })
  return added
}

/** notification:read (từ tab này hoặc tab khác) → đánh dấu đã đọc, không trừ hai lần. */
export function applyNotificationRead(queryClient: QueryClient, id: string, readAt = new Date().toISOString()) {
  queryClient.setQueryData<NotificationPage>(notificationsKey, (page) => {
    const target = page?.notifications.find((n) => n.id === id)
    if (!page || !target || target.readAt) return page
    return {
      ...page,
      notifications: page.notifications.map((n) => (n.id === id ? { ...n, readAt } : n)),
      unreadCount: Math.max(0, page.unreadCount - 1),
    }
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => chatApi.markNotificationRead(id),
    onSuccess: (_data, id) => applyNotificationRead(queryClient, id),
  })
}

export function describeNotification(n: Notification): string {
  switch (n.type) {
    case 'mention':
      return 'Bạn được nhắc đến'
    case 'dm':
      return 'Tin nhắn riêng mới'
    default:
      return 'Thông báo hệ thống'
  }
}

// ---- Phòng đang mở (để không bật toast cho hội thoại người dùng đang xem) ----

let activeRoomId: string | null = null
export function setActiveRoom(roomId: string | null) {
  activeRoomId = roomId
}
export function isViewingRoom(roomId: string | null | undefined): boolean {
  return Boolean(roomId) && roomId === activeRoomId && document.visibilityState === 'visible'
}

// ---- Toast ----

export interface Toast {
  id: string
  title: string
  body: string
  tone?: 'info' | 'error'
  roomId?: string | null
  notificationId?: string
}

export const TOAST_MS = 6_000
let toasts: Toast[] = []
const toastListeners = new Set<() => void>()
const emitToasts = () => { for (const l of toastListeners) l() }

export function pushToast(toast: Toast) {
  if (toasts.some((t) => t.id === toast.id)) return
  toasts = [...toasts, toast].slice(-4)
  emitToasts()
  setTimeout(() => dismissToast(toast.id), TOAST_MS)
}

export function dismissToast(id: string) {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emitToasts()
}

export function resetToasts() {
  toasts = []
  emitToasts()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => { toastListeners.add(listener); return () => { toastListeners.delete(listener) } },
    () => toasts,
  )
}
