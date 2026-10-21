import type { Client } from '@stomp/stompjs'

/**
 * STOMP client đã CONNECTED hiện tại (hoặc null), để các tính năng khác (chat…)
 * dùng chung đúng một socket do useRealtime quản lý.
 */
type Listener = (client: Client | null) => void

let active: Client | null = null
const listeners = new Set<Listener>()

export function getActiveClient(): Client | null {
  return active
}

export function setActiveClient(client: Client | null) {
  if (active === client) return
  active = client
  for (const listener of listeners) listener(client)
}

/** Bỏ client nếu nó vẫn đang là client hiện tại (tránh xoá nhầm client mới). */
export function clearActiveClient(client: Client) {
  if (active === client) setActiveClient(null)
}

export function onActiveClientChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
