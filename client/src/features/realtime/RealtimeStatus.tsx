import { useRealtime, type RealtimeState } from './useRealtime'

const labels: Record<RealtimeState, string> = {
  connecting: 'Đang kết nối…', connected: 'Đã xác thực kết nối', disconnected: 'Mất kết nối',
  unauthorized: 'Kết nối không được phép', limited: 'Đã đạt giới hạn 5 kết nối', mock: 'Mock mode — không có kết nối thật',
}

export function RealtimeStatus() {
  const { state, lastPong } = useRealtime()
  return (
    <section className="home-card" aria-label="Kết nối realtime">
      <h2>Kết nối realtime</h2>
      <p role="status">{labels[state]}</p>
      {lastPong && <p>Máy chủ phản hồi lúc {new Date(lastPong).toLocaleTimeString('vi-VN')}</p>}
    </section>
  )
}
