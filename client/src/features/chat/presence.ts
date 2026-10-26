import { useQuery, type QueryClient } from '@tanstack/react-query'
import { chatApi } from './chatApi'
import type { Presence } from './types'

/** F06. Nằm dưới ['chat'] nên được tải lại snapshot sau mỗi lần reconnect. */
export const presenceKey = ['chat', 'presence'] as const

export function usePresence() {
  const query = useQuery({
    queryKey: presenceKey,
    queryFn: () => chatApi.getPresence(),
    staleTime: Infinity,
  })
  const byUser = new Map((query.data ?? []).map((p) => [p.userId, p]))
  return { byUser, get: (userId: string | undefined) => (userId ? byUser.get(userId) : undefined) }
}

/** Áp presence:update vào snapshot (thêm user mới nếu chưa có). */
export function applyPresence(queryClient: QueryClient, update: Presence) {
  queryClient.setQueryData<Presence[]>(presenceKey, (list) => {
    if (!list) return list
    return list.some((p) => p.userId === update.userId)
      ? list.map((p) => (p.userId === update.userId ? update : p))
      : [...list, update]
  })
}

/** "Đang hoạt động" / "Hoạt động 5 phút trước" / "Chưa hoạt động". */
export function describePresence(presence: Presence | undefined, now = Date.now()): string {
  if (presence?.online) return 'Đang hoạt động'
  if (!presence?.lastSeen) return 'Chưa hoạt động'
  const minutes = Math.floor((now - Date.parse(presence.lastSeen)) / 60_000)
  if (minutes < 1) return 'Vừa hoạt động'
  if (minutes < 60) return `Hoạt động ${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hoạt động ${hours} giờ trước`
  return `Hoạt động ${Math.floor(hours / 24)} ngày trước`
}
