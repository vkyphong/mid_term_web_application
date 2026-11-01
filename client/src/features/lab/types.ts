export const PROTOCOLS = ['poll', 'long-poll', 'sse', 'websocket'] as const
export type Protocol = typeof PROTOCOLS[number]
export const protocolNames: Record<Protocol, string> = { poll: 'Polling', 'long-poll': 'Long Polling', sse: 'SSE', websocket: 'WebSocket thuần' }

export interface Workload { count: number; intervalMs: number; payloadBytes: number; pollMs: number }
export const defaultWorkload: Workload = { count: 20, intervalMs: 250, payloadBytes: 128, pollMs: 100 }

export interface LabEvent {
  type: 'lab:pong'
  payload: { id: string; text: string }
  ts: string
  sequence: number
  correlationId?: string
}
export interface LabPage { events: LabEvent[]; nextCursor: number; resetRequired: boolean }
export interface Sample { index: number; latencyMs: number; sentAtMs: number; scheduleLagMs: number }
export interface LabMetrics {
  httpRequests: number
  httpResponses: number
  setupHttpRequests: number
  requestHeaderBytesEstimate: number
  responseHeaderBytesEstimate: number
  httpBodyBytesSent: number
  httpBodyBytesReceived: number
  wsHandshakeCount: number
  wsFrameOverheadBytesEstimate: number
  wsPayloadBytesSent: number
  wsPayloadBytesReceived: number
}
export interface LabResult {
  protocol: Protocol
  status: 'complete' | 'failed' | 'cancelled'
  config: Workload
  samples: Sample[]
  metrics: LabMetrics
  startedAt: string
  setupMs: number
  workloadElapsedMs: number
  totalElapsedMs: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  error?: string
}
export interface LabProgress { protocol: Protocol; phase: 'setup' | 'running'; sent: number; received: number }
