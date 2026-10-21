import { createContext, useContext } from 'react'
import type { RealtimeState } from './useRealtime'

export interface RealtimeStatusValue {
  state: RealtimeState
  lastPong: string | null
}

const fallback: RealtimeStatusValue = { state: 'disconnected', lastPong: null }

export const RealtimeContext = createContext<RealtimeStatusValue | null>(null)

/** Trạng thái kết nối dùng chung; ngoài <RealtimeProvider> coi như chưa kết nối. */
export function useRealtimeStatus(): RealtimeStatusValue {
  return useContext(RealtimeContext) ?? fallback
}
