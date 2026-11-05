import type { BoardEvent, BoardSnapshot, Point, SegmentInput } from './types'

/** Each accepted operation advances exactly one server revision. Never bridge a gap by guessing. */
export function applyBoardEvent(board: BoardSnapshot, event: BoardEvent): BoardSnapshot | null {
  const p = event.payload
  if (p.roomId !== board.roomId || p.revision <= board.revision) return board
  if (p.revision !== board.revision + 1) return null
  if (event.type === 'whiteboard:cleared') {
    if (p.generation !== board.generation + 1) return null
    return { roomId: board.roomId, generation: p.generation, revision: p.revision, segments: [] }
  }
  if (event.payload.generation !== board.generation) return null
  return { ...board, revision: p.revision, segments: [...board.segments, event.payload] }
}

export function mergeBoardSnapshot(board: BoardSnapshot, events: BoardEvent[]): { board: BoardSnapshot; gap: boolean } {
  let current = board
  for (const event of [...events].sort((a, b) => a.payload.revision - b.payload.revision)) {
    const next = applyBoardEvent(current, event)
    if (!next) return { board: current, gap: true }
    current = next
  }
  return { board: current, gap: false }
}

export function normalizedPoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point {
  const normalize = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000
  return { x: normalize((clientX - rect.left) / Math.max(1, rect.width)), y: normalize((clientY - rect.top) / Math.max(1, rect.height)) }
}

/** Canvas paths are independent per segment/author; a one-point stroke draws a round dot. */
export function paintSegment(ctx: CanvasRenderingContext2D, segment: Pick<SegmentInput, 'points' | 'color' | 'width'>) {
  if (!segment.points.length) return
  ctx.strokeStyle = segment.color; ctx.fillStyle = segment.color; ctx.lineWidth = segment.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  if (segment.points.length === 1) {
    const p = segment.points[0]
    ctx.arc(p.x * 1000, p.y * 600, segment.width / 2, 0, Math.PI * 2); ctx.fill()
  } else {
    segment.points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x * 1000, p.y * 600); else ctx.lineTo(p.x * 1000, p.y * 600) })
    ctx.stroke()
  }
}

export type Shape = 'line' | 'arrow' | 'rect' | 'ellipse' | 'triangle'
export const BOARD_W = 1000
export const BOARD_H = 600
const ELLIPSE_STEPS = 40

/**
 * Điểm đường viền của một hình kéo từ `a` tới `b` (toạ độ chuẩn hoá 0–1), dạng một nét duy nhất ≤ 48 điểm.
 * `even` (giữ Shift): hình vuông / tròn / tam giác đều cạnh, đường thẳng bắt góc 45°.
 */
export function shapePoints(shape: Shape, a: Point, b: Point, even = false): Point[] {
  const ax = a.x * BOARD_W, ay = a.y * BOARD_H
  let bx = b.x * BOARD_W, by = b.y * BOARD_H
  if (even) {
    const dx = bx - ax, dy = by - ay
    if (shape === 'line' || shape === 'arrow') {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      bx = ax + Math.cos(angle) * len; by = ay + Math.sin(angle) * len
    } else {
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      bx = ax + Math.sign(dx || 1) * side; by = ay + Math.sign(dy || 1) * side
    }
  }
  const px: [number, number][] = []
  if (shape === 'line') px.push([ax, ay], [bx, by])
  else if (shape === 'arrow') {
    const angle = Math.atan2(by - ay, bx - ax)
    const head = Math.min(28, Math.max(10, Math.hypot(bx - ax, by - ay) * 0.25))
    const wing = (side: number): [number, number] => [bx - head * Math.cos(angle + side * Math.PI / 7), by - head * Math.sin(angle + side * Math.PI / 7)]
    px.push([ax, ay], [bx, by], wing(1), [bx, by], wing(-1))
  } else if (shape === 'rect') px.push([ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay])
  else if (shape === 'triangle') px.push([(ax + bx) / 2, ay], [bx, by], [ax, by], [(ax + bx) / 2, ay])
  else {
    const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2
    for (let i = 0; i <= ELLIPSE_STEPS; i++) {
      const t = (i / ELLIPSE_STEPS) * Math.PI * 2
      px.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
    }
  }
  const norm = (v: number, max: number) => Math.round(Math.min(1, Math.max(0, v / max)) * 10000) / 10000
  return px.map(([x, y]) => ({ x: norm(x, BOARD_W), y: norm(y, BOARD_H) }))
}
