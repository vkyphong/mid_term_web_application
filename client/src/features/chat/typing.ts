import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { chatTransport } from './chatApi'
import type { TypingPayload } from './types'

/** F07: gửi typing:start tối đa mỗi 2 s (< TTL 3 s nên chỉ báo không bị nháy). */
export const TYPING_THROTTLE_MS = 2_000
/** Ngừng gõ quá 2,5 s thì gửi typing:stop. */
export const TYPING_IDLE_MS = 2_500

// ---- Phía nhận: ai đang gõ trong phòng nào, tự hết hạn theo ttlMs ----

const typingByRoom = new Map<string, Map<string, number>>() // roomId → userId → expiresAt
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const listeners = new Set<() => void>()
const snapshots = new Map<string, string[]>()

function emit(roomId: string) {
  snapshots.delete(roomId)
  for (const listener of listeners) listener()
}

function expire(roomId: string, userId: string) {
  const users = typingByRoom.get(roomId)
  if (!users?.delete(userId)) return
  if (users.size === 0) typingByRoom.delete(roomId)
  emit(roomId)
}

export function applyTyping(event: TypingPayload, now = Date.now()) {
  const key = `${event.roomId}:${event.userId}`
  clearTimeout(timers.get(key))
  timers.delete(key)
  if (!event.typing) return expire(event.roomId, event.userId)

  const users = typingByRoom.get(event.roomId) ?? new Map<string, number>()
  typingByRoom.set(event.roomId, users)
  users.set(event.userId, now + event.ttlMs)
  timers.set(key, setTimeout(() => { timers.delete(key); expire(event.roomId, event.userId) }, event.ttlMs))
  emit(event.roomId)
}

/** Xoá toàn bộ (vd khi đăng xuất). */
export function resetTyping() {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  const rooms = [...typingByRoom.keys()]
  typingByRoom.clear()
  rooms.forEach(emit)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function snapshot(roomId: string): string[] {
  let users = snapshots.get(roomId)
  if (!users) {
    users = [...(typingByRoom.get(roomId)?.keys() ?? [])]
    snapshots.set(roomId, users)
  }
  return users
}

/** userId của những người đang gõ trong phòng (trừ chính mình). */
export function useTypingUsers(roomId: string, selfId: string | undefined): string[] {
  const users = useSyncExternalStore(subscribe, () => snapshot(roomId))
  return selfId ? users.filter((id) => id !== selfId) : users
}

// ---- Phía gửi ----

/** Gắn vào ô soạn tin: throttle typing:start, typing:stop khi dừng / gửi / rời phòng. */
export function useTypingSender(roomId: string) {
  const lastStart = useRef(0)
  const active = useRef(false)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)

  const stop = useCallback(() => {
    clearTimeout(idle.current)
    if (!active.current) return
    active.current = false
    lastStart.current = 0
    chatTransport.request('typing:stop', { roomId }).catch(() => {})
  }, [roomId])

  const onInput = useCallback(
    (value: string) => {
      if (!value.trim()) return stop()
      const now = Date.now()
      if (!active.current || now - lastStart.current >= TYPING_THROTTLE_MS) {
        active.current = true
        lastStart.current = now
        chatTransport.request('typing:start', { roomId }).catch(() => {})
      }
      clearTimeout(idle.current)
      idle.current = setTimeout(stop, TYPING_IDLE_MS)
    },
    [roomId, stop],
  )

  // Rời phòng (đổi phòng / unmount) khi đang gõ → báo dừng.
  useEffect(() => stop, [stop])

  return { onInput, onSent: stop }
}

/** "Phong đang gõ…", "Phong và An đang gõ…", "Nhiều người đang gõ…". */
export function describeTyping(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} đang gõ…`
  if (names.length === 2) return `${names[0]} và ${names[1]} đang gõ…`
  return 'Nhiều người đang gõ…'
}
