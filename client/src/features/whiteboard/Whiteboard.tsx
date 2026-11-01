import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { config } from '../../config'
import { useSession } from '../auth/hooks'
import { normalizedPoint, paintSegment } from './model'
import { BoardSession, type BoardState } from './session'
import { MAX_POINTS, MAX_SEGMENTS, SEND_INTERVAL_MS, type Point, type SegmentInput } from './types'
import './whiteboard.css'

const palette = [
  ['#1f2937', 'Đen'], ['#4f46e5', 'Tím'], ['#2563eb', 'Xanh dương'],
  ['#059669', 'Xanh lá'], ['#dc2626', 'Đỏ'], ['#d97706', 'Cam'],
] as const
const initial: BoardState = { snapshot: null, pending: [], syncing: true, connected: false, clearing: false, canDraw: false, canClear: false, error: null, notice: null }

function ClearConfirmation({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); focus?.focus() }
  }, [])
  return <dialog ref={ref} className="whiteboard-dialog" aria-labelledby="whiteboard-clear-title" onCancel={(e) => { e.preventDefault(); onClose() }}>
    <h2 id="whiteboard-clear-title">Xóa bảng cho cả phòng?</h2>
    <p>Tất cả nét đã lưu sẽ bị xóa đối với mọi thành viên. Thao tác này không có hoàn tác.</p>
    <div><button type="button" className="btn-secondary" autoFocus onClick={onClose}>Hủy</button><button type="button" className="whiteboard-danger" onClick={onConfirm}>Xác nhận xóa bảng</button></div>
  </dialog>
}

export function Whiteboard({ roomId }: { roomId: string }) {
  const { user } = useSession()
  const selfId = user?.id
  const [state, setState] = useState<BoardState>(initial)
  const [color, setColor] = useState('#1f2937')
  const [width, setWidth] = useState(4)
  const [draft, setDraft] = useState<Pick<SegmentInput, 'points' | 'color' | 'width'> | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const session = useRef<BoardSession | null>(null)
  const stroke = useRef<{ pointer: number; points: Point[]; color: string; width: number; moved: boolean } | null>(null)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!selfId || config.useMockApi) return
    const board = new BoardSession(roomId, selfId)
    session.current = board
    const off = board.subscribe(() => setState(board.getSnapshot()))
    board.start()
    setState(board.getSnapshot())
    return () => { off(); board.stop(); session.current = null; clearTimeout(flushTimer.current); stroke.current = null }
  }, [roomId, selfId])

  useEffect(() => {
    // A remote clear or disconnect must not let a pointer's older draft enter a new generation.
    stroke.current = null; clearTimeout(flushTimer.current); setDraft(null)
  }, [state.snapshot?.generation, state.connected, state.syncing])

  useEffect(() => {
    // Keep incremental previews and snapshot replays on the same software rasterization path.
    const ctx = canvas.current?.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.clearRect(0, 0, 1000, 600)
    const saved = state.snapshot?.segments ?? []
    saved.forEach((segment) => paintSegment(ctx, segment))
    const known = new Set(saved.filter((s) => s.authorId === user?.id).map((s) => s.operationId))
    state.pending.filter((s) => !known.has(s.operationId)).forEach((s) => paintSegment(ctx, s))
    if (draft) paintSegment(ctx, draft)
  }, [state.snapshot, state.pending, draft, user?.id])

  const flush = (final = false) => {
    clearTimeout(flushTimer.current)
    const current = stroke.current
    if (!current) return
    // A repeated anchor between batches preserves continuity without joining different strokes.
    if (current.points.length > 1 || (!current.moved && final)) {
      if (!session.current?.enqueue(current.points, current.color, current.width)) {
        setLocalError('Đã tạm dừng nét vẽ: bảng đang đồng bộ, đầy hoặc có quá nhiều đoạn chờ gửi.')
        stroke.current = null; setDraft(null); return
      }
      current.moved = true
      current.points = [current.points[current.points.length - 1]]
    }
    if (final) { stroke.current = null; setDraft(null) }
    else {
      setDraft({ points: [...current.points], color: current.color, width: current.width })
      flushTimer.current = setTimeout(() => flush(), SEND_INTERVAL_MS)
    }
  }
  const point = (event: PointerEvent<HTMLCanvasElement>) => normalizedPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  const down = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!state.canDraw || stroke.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    const points = [point(event)]
    stroke.current = { pointer: event.pointerId, points, color, width, moved: false }
    setLocalError(null); setDraft({ points, color, width })
    flushTimer.current = setTimeout(() => flush(), SEND_INTERVAL_MS)
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current
    if (!current || current.pointer !== event.pointerId) return
    const next = point(event), last = current.points[current.points.length - 1]
    if (next.x === last.x && next.y === last.y) return
    current.points.push(next)
    if (current.points.length >= MAX_POINTS) flush()
    else setDraft({ points: [...current.points], color: current.color, width: current.width })
  }
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (stroke.current?.pointer !== event.pointerId) return
    move(event); flush(true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (config.useMockApi) return <div className="whiteboard-empty">Bảng trắng cần backend thật. Tắt VITE_USE_MOCK_API để sử dụng.</div>
  const status = state.syncing ? 'Đang đồng bộ bảng…' : !state.connected ? 'Mất kết nối · tạm khóa vẽ' : state.clearing ? 'Đang xóa bảng…' : state.pending.length ? `${state.pending.length} đoạn đang chờ xác nhận` : state.snapshot ? 'Đã đồng bộ' : 'Chưa tải được bảng'
  return <section className="whiteboard" aria-label="Bảng trắng cộng tác">
    <div className="whiteboard-toolbar">
      <div className="whiteboard-colors" role="group" aria-label="Màu bút">{palette.map(([value, label]) => <button type="button" key={value} style={{ background: value }} title={label} aria-label={`Bút màu ${label.toLowerCase()}`} aria-pressed={color === value} onClick={() => setColor(value)} disabled={!state.canDraw} />)}</div>
      <label className="whiteboard-width">Độ dày<select value={width} onChange={(e) => setWidth(Number(e.target.value))} disabled={!state.canDraw}>{[2, 4, 8, 12].map((w) => <option key={w} value={w}>{w} px</option>)}</select></label>
      <span className="whiteboard-saved-count">{state.snapshot?.segments.length ?? 0}/{MAX_SEGMENTS} đoạn</span>
      <button type="button" className="btn-secondary" disabled={!state.canClear || stroke.current !== null} onClick={() => setConfirmClear(true)}>Xóa bảng</button>
    </div>
    <div className="whiteboard-status" role="status"><span className={state.canDraw ? 'whiteboard-ready-dot' : 'whiteboard-wait-dot'} />{status}<span className="whiteboard-version">Phiên {state.snapshot?.generation ?? '—'} · v{state.snapshot?.revision ?? '—'}</span></div>
    {(state.error || localError) && <div className="whiteboard-error" role="alert"><span>{state.error ?? localError}</span><button type="button" className="btn-secondary" onClick={() => { setLocalError(null); void session.current?.retry() }} disabled={state.syncing || state.clearing}>Thử lại</button></div>}
    {state.notice && <p className="whiteboard-notice" role="status">{state.notice}</p>}
    <div className={`whiteboard-surface${state.canDraw ? '' : ' whiteboard-surface--disabled'}`}>
      <canvas ref={canvas} width={1000} height={600} aria-label="Vùng vẽ bảng trắng" aria-disabled={!state.canDraw} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={(e) => { if (stroke.current?.pointer === e.pointerId) flush(true) }} onLostPointerCapture={(e) => { if (stroke.current?.pointer === e.pointerId) flush(true) }}>Trình duyệt cần hỗ trợ Canvas để vẽ bảng trắng.</canvas>
      {state.syncing && <div className="whiteboard-loading">Đang tải nét vẽ đã lưu…</div>}
    </div>
    <p className="whiteboard-hint">Vẽ bằng chuột, bút hoặc chạm. Mọi thành viên trong phòng thấy cùng một bảng. Nét đã xác nhận được lưu; rời bảng sẽ bỏ phần chưa gửi. Không có hoàn tác.</p>
    {confirmClear && <ClearConfirmation onClose={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); void session.current?.clear() }} />}
  </section>
}
