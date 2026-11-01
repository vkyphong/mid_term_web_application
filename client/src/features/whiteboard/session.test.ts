import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiError'
import { BoardSession, type BoardDependencies } from './session'
import type { BoardEvent, BoardSnapshot, Segment, SegmentInput } from './types'

vi.mock('../chat/chatApi', () => ({ chatTransport: {} }))
const initial = (): BoardSnapshot => ({ roomId: 'r', generation: 0, revision: 0, segments: [] })
const saved = (input: SegmentInput, revision: number): Segment => ({ ...input, authorId: 'a', revision, createdAt: 'now' })
const point = [{ x: .1, y: .2 }, { x: .5, y: .6 }]
const sessions: BoardSession[] = []

function harness(snapshot = initial()) {
  let push!: (event: BoardEvent) => void
  let connection!: (connected: boolean) => void
  const deps: BoardDependencies = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    segment: vi.fn(), clear: vi.fn(),
    events: (listener) => { push = listener; return vi.fn() },
    connection: (listener) => { connection = listener; return vi.fn() },
    isConnected: () => true,
  }
  const board = new BoardSession('r', 'a', deps)
  sessions.push(board)
  return { board, deps: vi.mocked(deps), push: (event: BoardEvent) => push(event), connection: (value: boolean) => connection(value) }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { sessions.splice(0).forEach((s) => s.stop()); vi.useRealTimers(); vi.restoreAllMocks() })

it('buffers an event arriving during snapshot loading, then deduplicates its ack', async () => {
  const h = harness()
  let resolve!: (value: BoardSnapshot) => void
  h.deps.snapshot.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  h.board.start()
  const input: SegmentInput = { roomId: 'r', generation: 0, operationId: 'one', color: '#1f2937', width: 4, points: point }
  h.push({ type: 'whiteboard:segment', payload: saved(input, 1), ts: 'now' })
  resolve(initial())
  await vi.advanceTimersByTimeAsync(0)
  expect(h.board.getSnapshot().snapshot?.segments).toHaveLength(1)
  h.push({ type: 'whiteboard:segment', payload: saved(input, 1), ts: 'now' })
  expect(h.board.getSnapshot().snapshot?.segments).toHaveLength(1)
})

it('bounds pending work and retries a lost ack with the same operation ID after reconnect', async () => {
  const h = harness()
  h.deps.segment.mockRejectedValueOnce(new ApiError(0, { code: 'network_error' }))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  expect(h.board.enqueue(point, '#1f2937', 4)).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  const operation = h.deps.segment.mock.calls[0][0]
  expect(h.board.getSnapshot().pending).toHaveLength(1)
  expect(h.board.getSnapshot().canDraw).toBe(false)
  h.connection(false)
  h.deps.snapshot.mockResolvedValue({ ...initial(), revision: 1, segments: [saved(operation, 1)] })
  h.deps.segment.mockResolvedValue(saved(operation, 1))
  h.connection(true)
  await vi.advanceTimersByTimeAsync(250)
  expect(h.deps.segment.mock.calls[1][0].operationId).toBe(operation.operationId)
  expect(h.board.getSnapshot().pending).toHaveLength(0)
  expect(h.board.getSnapshot().snapshot?.segments).toHaveLength(1)
})

it('limits the outbox to 32 batches while a command remains in flight', async () => {
  const h = harness()
  h.deps.segment.mockReturnValue(new Promise(() => {}))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 32; i++) expect(h.board.enqueue(point, '#1f2937', 4)).toBe(true)
  expect(h.board.enqueue(point, '#1f2937', 4)).toBe(false)
  expect(h.board.getSnapshot().pending).toHaveLength(32)
  expect(h.deps.segment).toHaveBeenCalledOnce()
})

it('spaces batches by 200 ms without spending chat rate-limit tokens', async () => {
  const h = harness()
  let revision = 0
  h.deps.segment.mockImplementation(async (input) => saved(input, ++revision))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  h.board.enqueue(point, '#1f2937', 4); h.board.enqueue(point, '#dc2626', 8)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.deps.segment).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(199)
  expect(h.deps.segment).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(h.deps.segment).toHaveBeenCalledTimes(2)
  expect(h.board.getSnapshot().pending).toHaveLength(0)
})

it('drops older-generation queued work on remote clear and does not replay it', async () => {
  const h = harness()
  h.deps.segment.mockReturnValue(new Promise(() => {}))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  h.board.enqueue(point, '#1f2937', 4)
  h.push({ type: 'whiteboard:cleared', payload: { roomId: 'r', generation: 1, revision: 1, operationId: 'clear', authorId: 'b' }, ts: 'now' })
  expect(h.board.getSnapshot().pending).toHaveLength(0)
  expect(h.board.getSnapshot().snapshot?.generation).toBe(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.deps.segment).toHaveBeenCalledOnce()
})

it('retries an ambiguous clear with its original generation/ID and keeps newer strokes', async () => {
  const h = harness()
  h.deps.clear.mockRejectedValueOnce(new ApiError(0, { code: 'network_error' }))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  await h.board.clear()
  const input = h.deps.clear.mock.calls[0][0]
  expect(h.board.getSnapshot().canDraw).toBe(false)
  const clear = { ...input, generation: 1, revision: 1, authorId: 'a' }
  h.push({ type: 'whiteboard:cleared', payload: clear, ts: 'now' })
  h.push({ type: 'whiteboard:segment', payload: saved({ roomId: 'r', generation: 1, operationId: 'later', color: '#dc2626', width: 4, points: point }, 2), ts: 'now' })
  h.deps.clear.mockResolvedValue(clear)
  await h.board.retry()
  expect(h.deps.clear.mock.calls[1][0]).toEqual(input)
  expect(h.board.getSnapshot().snapshot?.segments).toHaveLength(1)
  expect(h.board.getSnapshot().snapshot?.revision).toBe(2)
})

it('resynchronizes a revision gap and hides data if membership is revoked', async () => {
  const h = harness()
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  h.deps.snapshot.mockRejectedValue(new ApiError(403, { code: 'forbidden' }))
  h.push({ type: 'whiteboard:segment', payload: saved({ roomId: 'r', generation: 0, operationId: 'gap', color: '#1f2937', width: 4, points: point }, 3), ts: 'now' })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.board.getSnapshot().snapshot).toBeNull()
  expect(h.board.getSnapshot().canDraw).toBe(false)
  expect(h.board.getSnapshot().error).toMatch(/quyền truy cập/)
})

it('hides the board when a clear command loses membership authorization', async () => {
  const h = harness()
  h.deps.clear.mockRejectedValue(new ApiError(403, { code: 'forbidden' }))
  h.board.start(); await vi.advanceTimersByTimeAsync(0)
  await h.board.clear()
  expect(h.board.getSnapshot().snapshot).toBeNull()
  expect(h.board.getSnapshot().canDraw).toBe(false)
  expect(h.board.getSnapshot().canClear).toBe(false)
})
