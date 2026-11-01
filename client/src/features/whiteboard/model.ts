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
