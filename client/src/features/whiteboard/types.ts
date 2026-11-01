export interface Point { x: number; y: number }
export interface SegmentInput {
  roomId: string
  operationId: string
  generation: number
  color: string
  width: number
  points: Point[]
}
export interface Segment extends SegmentInput { authorId: string; revision: number; createdAt: string }
export interface ClearInput { roomId: string; operationId: string; generation: number }
export interface Cleared extends ClearInput { authorId: string; revision: number }
export interface BoardSnapshot { roomId: string; generation: number; revision: number; segments: Segment[] }
export type BoardEvent =
  | { type: 'whiteboard:segment'; payload: Segment; ts: string }
  | { type: 'whiteboard:cleared'; payload: Cleared; ts: string }
export const MAX_POINTS = 48
export const MAX_SEGMENTS = 1000
export const MAX_PENDING = 32
export const SEND_INTERVAL_MS = 200
