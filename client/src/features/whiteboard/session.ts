import { authRequest } from '../../lib/apiClient'
import { ApiError } from '../../lib/apiError'
import { uuid } from '../../lib/uuid'
import { chatTransport } from '../chat/chatApi'
import { getActiveClient, onActiveClientChange } from '../realtime/realtimeBus'
import { applyBoardEvent, mergeBoardSnapshot } from './model'
import { MAX_PENDING, MAX_POINTS, MAX_SEGMENTS, SEND_INTERVAL_MS, type BoardEvent, type BoardSnapshot, type ClearInput, type Cleared, type Point, type Segment, type SegmentInput } from './types'

export interface BoardDependencies {
  snapshot: (signal: AbortSignal) => Promise<BoardSnapshot>
  segment: (input: SegmentInput) => Promise<Segment>
  clear: (input: ClearInput) => Promise<Cleared>
  events: (listener: (event: BoardEvent) => void) => () => void
  connection: (listener: (connected: boolean) => void) => () => void
  isConnected: () => boolean
}
export interface BoardState {
  snapshot: BoardSnapshot | null
  pending: SegmentInput[]
  syncing: boolean
  connected: boolean
  clearing: boolean
  canDraw: boolean
  canClear: boolean
  error: string | null
  notice: string | null
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'forbidden' || error.code === 'unauthorized') return 'Bạn không còn quyền truy cập bảng này. Hãy kiểm tra phiên đăng nhập và thành viên phòng.'
    if (error.reason === 'board_full') return 'Bảng đã đủ 1000 đoạn nét. Xóa bảng để bắt đầu bảng mới.'
    if (error.reason === 'stale_board') return 'Bảng đã được xóa. Các nét cũ đang chờ gửi đã được bỏ.'
    if (error.code === 'rate_limited') return 'Đang chờ hạn mức vẽ; chat vẫn có hạn mức riêng.'
    if (error.code === 'network_error') return 'Chưa nhận được xác nhận. Kết nối lại hoặc bấm Thử lại; nét đã lưu sẽ không bị gửi trùng.'
  }
  return 'Không đồng bộ được bảng. Bấm Thử lại để tải trạng thái từ máy chủ.'
}

/** Bounded per-mounted-room outbox and snapshot/event reconciliation. No extra WebSocket. */
export class BoardSession {
  readonly roomId: string
  readonly selfId: string
  private state: BoardState = { snapshot: null, pending: [], syncing: true, connected: false, clearing: false, canDraw: false, canClear: false, error: null, notice: null }
  private readonly listeners = new Set<() => void>()
  private readonly buffer = new Map<number, BoardEvent>()
  private bufferOverflow = false
  private readonly deps: BoardDependencies
  private live = false
  private stops: (() => void)[] = []
  private syncTask: Promise<void> | null = null
  private syncAbort: AbortController | null = null
  private inFlight = false
  private blocked = false
  private clearOp: ClearInput | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastSend = -Infinity

  constructor(roomId: string, selfId: string, dependencies?: BoardDependencies) {
    this.roomId = roomId; this.selfId = selfId
    this.deps = dependencies ?? {
      snapshot: (signal) => authRequest(`/api/rooms/${encodeURIComponent(roomId)}/whiteboard`, { signal }),
      segment: (input) => chatTransport.request('whiteboard:segment', input),
      clear: (input) => chatTransport.request('whiteboard:clear', input),
      events: (listener) => chatTransport.onEvent((event) => { if (event.type === 'whiteboard:segment' || event.type === 'whiteboard:cleared') listener(event) }),
      connection: (listener) => onActiveClientChange((client) => listener(client !== null)),
      isConnected: () => getActiveClient() !== null,
    }
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<BoardState>) {
    if (!this.live) return
    const next = { ...this.state, ...patch }
    const available = next.snapshot !== null && next.connected && !next.syncing && !next.clearing && this.clearOp === null
    this.state = { ...next, canDraw: available && !this.blocked && next.pending.length < MAX_PENDING && next.snapshot!.segments.length + next.pending.length < MAX_SEGMENTS, canClear: available && next.pending.length === 0 && !this.inFlight }
    this.listeners.forEach((listener) => listener())
  }
  start() {
    this.live = true
    this.stops = [this.deps.events((event) => this.receive(event)), this.deps.connection((connected) => {
      this.update({ connected })
      if (connected) void this.sync()
      else { clearTimeout(this.timer); this.timer = undefined }
    })]
    this.update({ connected: this.deps.isConnected() })
    void this.sync()
  }
  stop() {
    this.live = false
    this.stops.forEach((stop) => stop()); this.stops = []
    this.syncAbort?.abort(); clearTimeout(this.timer)
    this.buffer.clear()
  }

  sync = (): Promise<void> => {
    if (!this.live) return Promise.resolve()
    if (this.syncTask) return this.syncTask
    this.syncAbort = new AbortController()
    this.update({ syncing: true })
    this.syncTask = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const snapshot = await this.deps.snapshot(this.syncAbort!.signal)
          if (!this.live) return
          if (this.bufferOverflow) { this.bufferOverflow = false; continue }
          const merged = mergeBoardSnapshot(snapshot, [...this.buffer.values()])
          if (merged.gap) continue
          this.buffer.clear()
          const pending = this.state.pending.filter((item) => item.generation === merged.board.generation)
          const dropped = pending.length !== this.state.pending.length
          if (this.clearOp && merged.board.generation > this.clearOp.generation) this.clearOp = null
          this.blocked = false
          this.update({ snapshot: merged.board, pending, error: null, notice: dropped ? 'Bảng đã được xóa; các nét cũ đang chờ gửi đã được bỏ.' : this.state.notice })
          return
        }
        throw new Error('Repeated board version gaps')
      } catch (error) {
        if (!this.live) return
        this.blocked = true
        const denied = error instanceof ApiError && (error.status === 401 || error.status === 403)
        this.update({ error: describe(error), ...(denied ? { snapshot: null, pending: [] } : {}) })
      } finally {
        this.syncTask = null
        this.update({ syncing: false })
        this.pump()
      }
    })()
    return this.syncTask
  }

  private receive(event: BoardEvent) {
    if (!this.live || event.payload.roomId !== this.roomId) return
    if (!this.state.snapshot || this.state.syncing) {
      this.buffer.set(event.payload.revision, event)
      if (this.buffer.size > 128) { this.buffer.clear(); this.bufferOverflow = true }
      return
    }
    const next = applyBoardEvent(this.state.snapshot, event)
    if (!next) {
      this.buffer.set(event.payload.revision, event)
      void this.sync()
      return
    }
    if (next === this.state.snapshot) return
    const pending = this.state.pending.filter((item) => item.generation === next.generation)
    this.update({ snapshot: next, pending, ...(event.type === 'whiteboard:cleared' ? { notice: 'Bảng vừa được xóa. Các nét mới sẽ thuộc bảng hiện tại.' } : {}) })
  }

  enqueue(points: Point[], color: string, width: number): boolean {
    if (!this.state.canDraw || !points.length || points.length > MAX_POINTS) return false
    const input: SegmentInput = { roomId: this.roomId, generation: this.state.snapshot!.generation, operationId: uuid(), points: points.map((p) => ({ ...p })), color, width }
    this.update({ pending: [...this.state.pending, input], error: null })
    this.pump()
    return true
  }

  private pump() {
    if (!this.live || this.inFlight || this.blocked || this.state.syncing || !this.state.connected || this.state.clearing || this.clearOp || !this.state.pending.length) return
    const delay = this.lastSend + SEND_INTERVAL_MS - Date.now()
    if (delay > 0) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.pump(), delay)
      return
    }
    const input = this.state.pending[0]
    this.inFlight = true; this.lastSend = Date.now(); this.update({})
    void this.deps.segment(input).then((segment) => {
      if (!this.live) return
      this.receive({ type: 'whiteboard:segment', payload: segment, ts: new Date().toISOString() })
      this.update({ pending: this.state.pending.filter((item) => item.operationId !== input.operationId) })
    }).catch((error: unknown) => {
      if (!this.live || !this.state.pending.some((item) => item.operationId === input.operationId)) return
      this.blocked = true
      if (error instanceof ApiError && error.reason === 'stale_board') {
        this.update({ pending: [], notice: describe(error) }); void this.sync()
      } else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.update({ snapshot: null, pending: [], error: describe(error) })
      } else if (error instanceof ApiError && error.reason === 'board_full') {
        this.update({ pending: [], error: describe(error) })
      } else {
        this.update({ error: describe(error) })
        if (error instanceof ApiError && error.code === 'rate_limited') this.timer = setTimeout(() => void this.retry(), 1250)
      }
    }).finally(() => { this.inFlight = false; this.update({}); this.pump() })
  }

  retry = async () => {
    if (this.clearOp) await this.performClear(this.clearOp)
    else await this.sync()
  }
  clear = async () => {
    if (!this.state.canClear || !this.state.snapshot) return
    this.clearOp = { roomId: this.roomId, generation: this.state.snapshot.generation, operationId: uuid() }
    await this.performClear(this.clearOp)
  }
  private async performClear(input: ClearInput) {
    this.update({ clearing: true, error: null })
    try {
      const data = await this.deps.clear(input)
      if (!this.live) return
      this.receive({ type: 'whiteboard:cleared', payload: data, ts: new Date().toISOString() })
      this.clearOp = null; this.blocked = false
      this.update({ notice: 'Đã xóa bảng cho mọi thành viên trong phòng.', error: null })
    } catch (error) {
      if (!this.live) return
      if (error instanceof ApiError && error.reason === 'stale_board') { this.clearOp = null; await this.sync() }
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.clearOp = null; this.blocked = true
        this.update({ snapshot: null, pending: [], error: describe(error) })
      }
      else this.update({ error: describe(error) })
    } finally { this.update({ clearing: false }); this.pump() }
  }
}
