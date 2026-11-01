import { describe, expect, it } from 'vitest'
import { byteLength, frameOverhead, percentile, requestHeaderEstimate, responseHeaderEstimate, SseParser, validateWorkload } from './measurements'
import { defaultWorkload } from './types'

describe('repeatable workload and accounting', () => {
  it('checks integer, rate, size and SSE-lifetime bounds', () => {
    expect(validateWorkload(defaultWorkload)).toBeNull()
    expect(validateWorkload({ ...defaultWorkload, count: 5, intervalMs: 100, payloadBytes: 0 })).toBeNull()
    expect(validateWorkload({ ...defaultWorkload, count: 4 })).toMatch(/5 đến 100/)
    expect(validateWorkload({ ...defaultWorkload, intervalMs: 50 })).toMatch(/100 đến 1000/)
    expect(validateWorkload({ ...defaultWorkload, count: 100, intervalMs: 500 })).toMatch(/45 giây/)
    expect(validateWorkload({ ...defaultWorkload, payloadBytes: NaN })).toMatch(/số nguyên/)
    expect(validateWorkload({ ...defaultWorkload, payloadBytes: 1025 })).toMatch(/1024/)
  })
  it('uses nearest-rank percentiles without modifying chronological observations', () => {
    const values = Array.from({ length: 20 }, (_, i) => 20 - i)
    expect(percentile(values, .5)).toBe(10)
    expect(percentile(values, .95)).toBe(19)
    expect(values[0]).toBe(20)
    expect(percentile([], .95)).toBeNull()
    expect(byteLength('ế')).toBe(3)
  })
  it('separates masked client/unmasked server overhead and extended lengths', () => {
    expect(frameOverhead(125, true)).toBe(6)
    expect(frameOverhead(126, true)).toBe(8)
    expect(frameOverhead(65535, false)).toBe(4)
    expect(frameOverhead(65536, false)).toBe(10)
  })
  it('counts an explicit HTTP/1.1 text estimate including request line, Host and body length', () => {
    const expected = 'POST /api/lab/ping HTTP/1.1\r\nHost: localhost:8080\r\ncontent-type: application/json\r\nContent-Length: 3\r\n\r\n'
    expect(requestHeaderEstimate(new URL('http://localhost:8080/api/lab/ping'), 'POST', new Headers({ 'Content-Type': 'application/json' }), 3)).toBe(byteLength(expected))
    const response = new Response('{}', { status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' } })
    expect(responseHeaderEstimate(response)).toBe(byteLength('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n'))
  })
})

describe('SSE framing', () => {
  it('handles arbitrary chunk boundaries, comments, multiline data and CRLF', () => {
    const received: unknown[] = []
    const parser = new SseParser((name, data) => received.push({ name, data }))
    const frame = ':keepalive\r\nevent: ready\r\ndata: {"events":[]}\r\n\r\nevent: lab:pong\ndata: first\ndata: second\n\n'
    for (const char of frame) parser.push(char)
    expect(received).toEqual([{ name: 'ready', data: '{"events":[]}' }, { name: 'lab:pong', data: 'first\nsecond' }])
  })
  it('does not dispatch partial or comment-only frames', () => {
    const received: string[] = []
    const parser = new SseParser((_name, data) => received.push(data))
    parser.push(':ignore\n\ndata: pending')
    expect(received).toEqual([])
    parser.push('\n\n')
    expect(received).toEqual(['pending'])
  })
})
