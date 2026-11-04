import { useSyncExternalStore } from 'react'

/** Hồ sơ đang mở (bấm avatar ở tin nhắn, đầu chat 1:1, danh sách thành viên). */
let openUserId: string | null = null
const listeners = new Set<() => void>()

export function openProfile(userId: string) {
  openUserId = userId
  listeners.forEach((l) => l())
}

export function closeProfile() {
  openUserId = null
  listeners.forEach((l) => l())
}

export function useOpenProfile(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => openUserId,
  )
}
