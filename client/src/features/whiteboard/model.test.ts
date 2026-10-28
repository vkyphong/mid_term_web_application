import { expect, it, vi } from 'vitest'
import { applyBoardEvent, mergeBoardSnapshot, normalizedPoint, paintSegment } from './model'
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
