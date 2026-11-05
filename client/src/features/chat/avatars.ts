import { useEffect, useState, useSyncExternalStore } from 'react'
import { chatApi } from './chatApi'
import type { UserAvatar } from './types'

/**
 * Ảnh đại diện tài khoản: userId → avatarUrl. Nạp một lần khi vào chat (GET /api/users/avatars),
 * cập nhật qua event user:avatar. Store thường (không phải React Query) để Avatar dùng được ở mọi nơi.
 */
let urls = new Map<string, string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function setUserAvatars(list: readonly UserAvatar[]) {
  urls = new Map(list.filter((a) => a.avatarUrl).map((a) => [a.userId, a.avatarUrl!]))
  emit()
}

export function setUserAvatar({ userId, avatarUrl }: UserAvatar) {
  urls = new Map(urls)
  if (avatarUrl) urls.set(userId, avatarUrl)
  else urls.delete(userId)
  emit()
}

export function resetUserAvatars() {
  urls = new Map()
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUserAvatarUrl(userId: string | undefined): string | undefined {
  return useSyncExternalStore(subscribe, () => (userId ? urls.get(userId) : undefined))
}

/** Ảnh tải bằng Bearer token, dùng lại theo URL (URL đổi khi ảnh đổi nên không cần thu hồi sớm). */
const images = new Map<string, Promise<string>>()

export function useAuthImage(url: string | null | undefined): string | undefined {
  const [src, setSrc] = useState<{ url: string; src: string }>()
  useEffect(() => {
    if (!url) return
    let cached = images.get(url)
    if (!cached) {
      // Bọc trong Promise: lỗi văng ngay (kể cả hàm giả trả undefined trong test) cũng thành ảnh lỗi → avatar chữ cái.
      cached = Promise.resolve()
        .then(() => chatApi.downloadFile(url))
        .then((blob) => URL.createObjectURL(blob))
      cached.catch(() => images.delete(url))
      images.set(url, cached)
    }
    let alive = true
    cached.then((value) => alive && setSrc({ url, src: value })).catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  return url && src?.url === url ? src.src : undefined
}
