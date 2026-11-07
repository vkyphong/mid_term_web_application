import { describe, expect, it, vi } from 'vitest'
import { applyBoardEvent, mergeBoardSnapshot, normalizedPoint, paintSegment, shapePoints } from './model'
import type { BoardEvent, BoardSnapshot, Segment } from './types'

const empty: BoardSnapshot = { roomId: 'r', generation: 0, revision: 0, segments: [] }
const segment = (revision: number, authorId = 'a'): Segment => ({ roomId: 'r', generation: 0, revision, operationId: `op-${revision}`, authorId, color: '#1f2937', width: 4, points: [{ x: .1, y: .2 }, { x: .5, y: .4 }], createdAt: '2026-10-28T00:00:00Z' })
const event = (revision: number, author?: string): BoardEvent => ({ type: 'whiteboard:segment', payload: segment(revision, author), ts: 'now' })

it('merges interleaved authors, duplicate acks/broadcasts and late snapshots by revision', () => {
  const first = applyBoardEvent(empty, event(1))!
  expect(applyBoardEvent(first, event(1))).toBe(first)
  const merged = mergeBoardSnapshot(first, [event(3, 'b'), event(2, 'a'), event(1)])
  expect(merged.gap).toBe(false)
  expect(merged.board.segments.map((s) => s.revision)).toEqual([1, 2, 3])
  expect(merged.board.segments[2].authorId).toBe('b')
})

it('requires recovery for gaps, ignores other rooms and never revives strokes after clear', () => {
  expect(applyBoardEvent(empty, event(2))).toBeNull()
  expect(applyBoardEvent(empty, { ...event(1), payload: { ...segment(1), roomId: 'other' } })).toBe(empty)
  const one = applyBoardEvent(empty, event(1))!
  const cleared = applyBoardEvent(one, { type: 'whiteboard:cleared', payload: { roomId: 'r', generation: 1, revision: 2, operationId: 'clear', authorId: 'a' }, ts: 'now' })!
  expect(cleared.segments).toEqual([])
  expect(applyBoardEvent(cleared, event(1))).toBe(cleared)
  expect(applyBoardEvent(cleared, event(3))).toBeNull()
  expect(mergeBoardSnapshot(empty, [event(3)]).gap).toBe(true)
})

it('normalizes/clamps coordinates identically for different viewport sizes', () => {
  expect(normalizedPoint(60, 35, { left: 10, top: 5, width: 100, height: 60 })).toEqual({ x: .5, y: .5 })
  expect(normalizedPoint(110, 65, { left: 10, top: 5, width: 200, height: 120 })).toEqual({ x: .5, y: .5 })
  expect(normalizedPoint(-10, 999, { left: 0, top: 0, width: 100, height: 60 })).toEqual({ x: 0, y: 1 })
})

it('begins a fresh path for every batch and draws a one-point stroke as a dot', () => {
  const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D
  paintSegment(ctx, segment(1))
  paintSegment(ctx, { ...segment(2), points: [{ x: .5, y: .5 }] })
  expect(ctx.beginPath).toHaveBeenCalledTimes(2)
  expect(ctx.moveTo).toHaveBeenCalledWith(100, 120)
  expect(ctx.lineTo).toHaveBeenCalledWith(500, 240)
  expect(ctx.arc).toHaveBeenCalledWith(500, 300, 2, 0, Math.PI * 2)
  expect(ctx.fill).toHaveBeenCalledOnce()
})

describe('shapePoints', () => {
  const a = { x: 0.1, y: 0.2 }, b = { x: 0.5, y: 0.6 }
  it('mỗi hình là một nét khép kín hợp lệ (≤ 48 điểm, toạ độ trong [0,1])', () => {
    for (const shape of ['line', 'arrow', 'rect', 'ellipse', 'triangle'] as const) {
      const pts = shapePoints(shape, a, b)
      expect(pts.length).toBeGreaterThanOrEqual(2)
      expect(pts.length).toBeLessThanOrEqual(48)
      for (const p of pts) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1) }
    }
    expect(shapePoints('rect', a, b)).toEqual([a, { x: 0.5, y: 0.2 }, b, { x: 0.1, y: 0.6 }, a])
    expect(shapePoints('line', a, b)).toEqual([a, b])
    const ellipse = shapePoints('ellipse', a, b)
    expect(ellipse[0]).toEqual(ellipse[ellipse.length - 1])
  })

  it('giữ Shift: hình vuông theo pixel và đường thẳng bắt góc 45°', () => {
    // Từ (100,120) kéo tới (500,360) pixel → cạnh 400 px.
    const square = shapePoints('rect', a, b, true)
    expect(square[2]).toEqual({ x: 0.5, y: 0.8667 })
    const line = shapePoints('line', { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.52 }, true)
    expect(line[1].y).toBe(0.5)
  })

  it('hình chạm mép bảng được kẹp trong [0,1]', () => {
    const arrow = shapePoints('arrow', { x: 0.99, y: 0.01 }, { x: 0, y: 0 })
    expect(arrow.every((p) => p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1)).toBe(true)
  })
})
