import { useRealtimeStatus } from './RealtimeContext'
import type { RealtimeState } from './useRealtime'

const labels: Record<RealtimeState, string> = {
  connecting: 'Đang kết nối…', connected: 'Đã kết nối', disconnected: 'Mất kết nối',
  unauthorized: 'Kết nối không được phép', limited: 'Đã đạt giới hạn 5 kết nối', mock: 'Mock mode',
}

const tones: Record<RealtimeState, 'ok' | 'warn' | 'error'> = {
  connecting: 'warn', connected: 'ok', disconnected: 'error', unauthorized: 'error', limited: 'error', mock: 'ok',
}

/** Chấm trạng thái kết nối realtime gọn trên header. */
export function RealtimeStatus() {
  const { state, lastPong } = useRealtimeStatus()
  const title = lastPong ? `Máy chủ phản hồi lúc ${new Date(lastPong).toLocaleTimeString('vi-VN')}` : undefined
  return (
    <span className={`status-pill status-pill--${tones[state]}`} role="status" title={title}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{labels[state]}</span>
    </span>
  )
}
