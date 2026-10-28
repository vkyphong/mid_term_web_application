import type { Workload } from './types'

export const byteLength = (text: string) => new TextEncoder().encode(text).length

export function validateWorkload(c: Workload): string | null {
  if (![c.count, c.intervalMs, c.payloadBytes, c.pollMs].every(Number.isInteger)) return 'Cấu hình phải là số nguyên.'
  if (c.count < 5 || c.count > 100) return 'Số tin phải từ 5 đến 100.'
  if (c.intervalMs < 100 || c.intervalMs > 1000) return 'Khoảng gửi phải từ 100 đến 1000 ms.'
  if (c.payloadBytes < 0 || c.payloadBytes > 1024) return 'Payload phải từ 0 đến 1024 byte.'
  if (c.pollMs < 50 || c.pollMs > 1000) return 'Chu kỳ polling phải từ 50 đến 1000 ms.'
  if (c.count * c.intervalMs > 45000) return 'Mỗi giao thức được chạy tối đa 45 giây để nằm trong thời hạn SSE.'
  return null
}

/** Nearest-rank percentile; values are copied so chronological samples remain intact. */
export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}

/** RFC 6455 base frame estimate, one unfragmented/uncompressed text frame. */
export function frameOverhead(bytes: number, masked: boolean): number {
  return 2 + (bytes >= 65536 ? 8 : bytes >= 126 ? 2 : 0) + (masked ? 4 : 0)
}

/** A documented HTTP/1.1 text model, never a browser wire-byte measurement. */
export function requestHeaderEstimate(url: URL, method: string, headers: Headers, bodyBytes: number | undefined): number {
  let text = `${method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n`
  headers.forEach((value, key) => { text += `${key}: ${value}\r\n` })
  if (bodyBytes !== undefined) text += `Content-Length: ${bodyBytes}\r\n`
  return byteLength(text + '\r\n')
}

export function responseHeaderEstimate(response: Response): number {
  let text = `HTTP/1.1 ${response.status} ${response.statusText}\r\n`
  response.headers.forEach((value, key) => { text += `${key}: ${value}\r\n` })
  return byteLength(text + '\r\n')
}

/** Incremental SSE parser: supports CR/LF/CRLF split across arbitrary network chunks. */
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = 'message'
  private readonly receive: (event: string, data: string) => void
  constructor(receive: (event: string, data: string) => void) { this.receive = receive }
  push(chunk: string) {
    this.buffer += chunk
    for (;;) {
      const end = this.buffer.search(/[\r\n]/)
      if (end < 0 || (this.buffer[end] === '\r' && end === this.buffer.length - 1)) return
      const line = this.buffer.slice(0, end)
      const length = this.buffer[end] === '\r' && this.buffer[end + 1] === '\n' ? 2 : 1
      this.buffer = this.buffer.slice(end + length)
      if (!line) {
        if (this.data.length) this.receive(this.event, this.data.join('\n'))
        this.data = []; this.event = 'message'
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') this.event = value
        if (field === 'data') this.data.push(value)
      }
    }
  }
}
