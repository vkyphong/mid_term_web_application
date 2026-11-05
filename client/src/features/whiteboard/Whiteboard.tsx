import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { config } from '../../config'
import { useSession } from '../auth/hooks'
import { normalizedPoint, paintSegment, shapePoints, type Shape } from './model'
import { BoardSession, type BoardState } from './session'
import { MAX_POINTS, MAX_SEGMENTS, SEND_INTERVAL_MS, type Point, type SegmentInput } from './types'
import './whiteboard.css'

const palette = [
  ['#1f2937', 'Đen'], ['#4f46e5', 'Tím'], ['#2563eb', 'Xanh dương'],
  ['#059669', 'Xanh lá'], ['#dc2626', 'Đỏ'], ['#d97706', 'Cam'],
] as const
type Tool = 'pen' | 'eraser' | Shape
const BACKGROUND = '#ffffff'
const PEN_WIDTHS = [2, 4, 8, 12]
const ERASER_WIDTHS = [12, 24, 40]
const icon = (d: string) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const TOOLS: { id: Tool; label: string; icon: JSX.Element }[] = [
  { id: 'pen', label: 'Bút vẽ', icon: icon('M4 20l4-1 11-11a2.1 2.1 0 0 0-3-3L5 16l-1 4ZM14 7l3 3') },
  { id: 'eraser', label: 'Tẩy', icon: icon('M8 20h12M5.5 14.5l7-7a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8l-2.5-2.5a1.4 1.4 0 0 1 0-2Z') },
  { id: 'line', label: 'Đường thẳng', icon: icon('M5 19L19 5') },
  { id: 'arrow', label: 'Mũi tên', icon: icon('M5 19L19 5M11 5h8v8') },
  { id: 'rect', label: 'Hình chữ nhật', icon: icon('M4 6h16v12H4z') },
  { id: 'ellipse', label: 'Hình elip', icon: icon('M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7Z') },
  { id: 'triangle', label: 'Tam giác', icon: icon('M12 4l9 16H3Z') },
]
const isShape = (tool: Tool): tool is Shape => tool !== 'pen' && tool !== 'eraser'
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
  const [tool, setTool] = useState<Tool>('pen')
  const [penWidth, setPenWidth] = useState(4)
  const [eraserWidth, setEraserWidth] = useState(24)
  const [draft, setDraft] = useState<Pick<SegmentInput, 'points' | 'color' | 'width'> | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const session = useRef<BoardSession | null>(null)
  const stroke = useRef<{ pointer: number; points: Point[]; color: string; width: number; moved: boolean; shape?: Shape; start?: Point } | null>(null)
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
    const start = point(event)
    const points = [start]
    const strokeColor = tool === 'eraser' ? BACKGROUND : color
    const width = tool === 'eraser' ? eraserWidth : penWidth
    setLocalError(null)
    if (isShape(tool)) {
      // Hình: chỉ xem trước khi kéo, thả chuột mới gửi đúng một nét.
      stroke.current = { pointer: event.pointerId, points, color: strokeColor, width, moved: false, shape: tool, start }
      setDraft(null)
      return
    }
    stroke.current = { pointer: event.pointerId, points, color: strokeColor, width, moved: false }
    setDraft({ points, color: strokeColor, width })
    flushTimer.current = setTimeout(() => flush(), SEND_INTERVAL_MS)
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = stroke.current
    if (!current || current.pointer !== event.pointerId) return
    const next = point(event)
    if (current.shape && current.start) {
      if (next.x === current.start.x && next.y === current.start.y) return
      current.moved = true
      current.points = shapePoints(current.shape, current.start, next, event.shiftKey)
      setDraft({ points: current.points, color: current.color, width: current.width })
      return
    }
    const last = current.points[current.points.length - 1]
    if (next.x === last.x && next.y === last.y) return
    current.points.push(next)
    if (current.points.length >= MAX_POINTS) flush()
    else setDraft({ points: [...current.points], color: current.color, width: current.width })
  }
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (stroke.current?.pointer !== event.pointerId) return
    move(event)
    const current = stroke.current
    if (current?.shape) {
      // Bấm rồi thả tại chỗ thì không vẽ hình.
      if (current.moved && !session.current?.enqueue(current.points, current.color, current.width))
        setLocalError('Chưa vẽ được hình: bảng đang đồng bộ, đầy hoặc có quá nhiều đoạn chờ gửi.')
      stroke.current = null; setDraft(null)
    } else flush(true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  if (config.useMockApi) return <div className="whiteboard-empty">Bảng trắng cần backend thật. Tắt VITE_USE_MOCK_API để sử dụng.</div>
  const status = state.syncing ? 'Đang đồng bộ bảng…' : !state.connected ? 'Mất kết nối · tạm khóa vẽ' : state.clearing ? 'Đang xóa bảng…' : state.pending.length ? `${state.pending.length} đoạn đang chờ xác nhận` : state.snapshot ? 'Đã đồng bộ' : 'Chưa tải được bảng'
  return <section className="whiteboard" aria-label="Bảng trắng cộng tác">
    <div className="whiteboard-toolbar">
      <div className="whiteboard-tools" role="group" aria-label="Công cụ vẽ">{TOOLS.map((t) => <button type="button" key={t.id} title={isShape(t.id) ? `${t.label} (giữ Shift để vẽ đều)` : t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} disabled={!state.canDraw}>{t.icon}</button>)}</div>
      <div className="whiteboard-colors" role="group" aria-label="Màu bút">{palette.map(([value, label]) => <button type="button" key={value} style={{ background: value }} title={label} aria-label={`Bút màu ${label.toLowerCase()}`} aria-pressed={tool !== 'eraser' && color === value} onClick={() => { setColor(value); if (tool === 'eraser') setTool('pen') }} disabled={!state.canDraw} />)}</div>
      {tool === 'eraser'
        ? <label className="whiteboard-width">Cỡ tẩy<select value={eraserWidth} onChange={(e) => setEraserWidth(Number(e.target.value))} disabled={!state.canDraw}>{ERASER_WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}</select></label>
        : <label className="whiteboard-width">Độ dày<select value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} disabled={!state.canDraw}>{PEN_WIDTHS.map((w) => <option key={w} value={w}>{w} px</option>)}</select></label>}
      <span className="whiteboard-saved-count">{state.snapshot?.segments.length ?? 0}/{MAX_SEGMENTS} đoạn</span>
      <button type="button" className="btn-secondary" disabled={!state.canClear || stroke.current !== null} onClick={() => setConfirmClear(true)}>Xóa bảng</button>
    </div>
    <div className="whiteboard-status" role="status" data-version={state.snapshot ? `${state.snapshot.generation}.${state.snapshot.revision}` : ''}><span className={state.canDraw ? 'whiteboard-ready-dot' : 'whiteboard-wait-dot'} />{status}</div>
    {(state.error || localError) && <div className="whiteboard-error" role="alert"><span>{state.error ?? localError}</span><button type="button" className="btn-secondary" onClick={() => { setLocalError(null); void session.current?.retry() }} disabled={state.syncing || state.clearing}>Thử lại</button></div>}
    {state.notice && <p className="whiteboard-notice" role="status">{state.notice}</p>}
    <div className={`whiteboard-surface${state.canDraw ? '' : ' whiteboard-surface--disabled'}${tool === 'eraser' ? ' whiteboard-surface--eraser' : ''}`}>
      <canvas ref={canvas} width={1000} height={600} aria-label="Vùng vẽ bảng trắng" aria-disabled={!state.canDraw} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={(e) => { if (stroke.current?.pointer === e.pointerId) flush(true) }} onLostPointerCapture={(e) => { if (stroke.current?.pointer === e.pointerId) flush(true) }}>Trình duyệt cần hỗ trợ Canvas để vẽ bảng trắng.</canvas>
      {state.syncing && <div className="whiteboard-loading">Đang tải nét vẽ đã lưu…</div>}
    </div>
    <p className="whiteboard-hint">Vẽ bằng chuột, bút hoặc chạm; chọn Tẩy để xoá từng phần, hoặc chọn hình rồi kéo để vẽ (giữ Shift cho hình vuông, hình tròn, góc 45°). Mọi thành viên trong phòng thấy cùng một bảng. Nét đã xác nhận được lưu; rời bảng sẽ bỏ phần chưa gửi. Không có hoàn tác.</p>
    {confirmClear && <ClearConfirmation onClose={() => setConfirmClear(false)} onConfirm={() => { setConfirmClear(false); void session.current?.clear() }} />}
  </section>
}
