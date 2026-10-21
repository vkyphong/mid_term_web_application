import type { ReactNode } from 'react'
import { RealtimeContext } from './RealtimeContext'
import { useRealtime } from './useRealtime'

/** Mở đúng một kết nối STOMP cho cả app (tối đa 5 socket/user ở BE). */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const value = useRealtime()
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
