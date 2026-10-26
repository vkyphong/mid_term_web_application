import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatTransport } from './chatApi'
import {
  TYPING_IDLE_MS,
  TYPING_THROTTLE_MS,
  applyTyping,
  describeTyping,
  resetTyping,
  useTypingSender,
  useTypingUsers,
} from './typing'

vi.mock('./chatApi', () => ({ chatTransport: { request: vi.fn() } }))
const request = vi.mocked(chatTransport.request)
const calls = () => request.mock.calls.map(([type]) => type)

beforeEach(() => {
  vi.useFakeTimers()
  request.mockReset().mockResolvedValue(undefined as never)
  resetTyping()
})
afterEach(() => vi.useRealTimers())

describe('F07 gửi typing', () => {
  it('throttle typing:start: gõ 20 phím trong 5 giây chỉ gửi 3 lần, không gửi theo từng phím', () => {
    const { result } = renderHook(() => useTypingSender('r1'))
    for (let i = 1; i <= 20; i++) {
      act(() => result.current.onInput('x'.repeat(i)))
      act(() => { vi.advanceTimersByTime(250) }) // 20 × 250 ms = 5 s
    }
    expect(calls().filter((t) => t === 'typing:start')).toHaveLength(3) // 0 s, 2 s, 4 s
    expect(calls()).not.toContain('typing:stop')
    expect(request).toHaveBeenCalledWith('typing:start', { roomId: 'r1' })
  })

  it(`ngừng gõ ${TYPING_IDLE_MS} ms thì gửi typing:stop đúng một lần`, () => {
    const { result } = renderHook(() => useTypingSender('r1'))
    act(() => result.current.onInput('chào'))
    act(() => { vi.advanceTimersByTime(TYPING_IDLE_MS - 1) })
    expect(calls()).toEqual(['typing:start'])
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(calls()).toEqual(['typing:start', 'typing:stop'])
  })

  it('gửi tin hoặc xoá hết nội dung thì dừng ngay; lần gõ tiếp theo gửi start lại', () => {
    const { result } = renderHook(() => useTypingSender('r1'))
    act(() => result.current.onInput('a'))
    act(() => result.current.onSent())
    act(() => result.current.onInput('b'))
    act(() => result.current.onInput(''))
    expect(calls()).toEqual(['typing:start', 'typing:stop', 'typing:start', 'typing:stop'])
  })

  it('rời phòng (unmount / đổi phòng) khi đang gõ thì gửi typing:stop cho phòng cũ', () => {
    const { result, rerender } = renderHook(({ room }) => useTypingSender(room), { initialProps: { room: 'r1' } })
    act(() => result.current.onInput('a'))
    rerender({ room: 'r2' })
    expect(request).toHaveBeenLastCalledWith('typing:stop', { roomId: 'r1' })
  })

  it(`không gửi lại start sớm hơn ${TYPING_THROTTLE_MS} ms`, () => {
    const { result } = renderHook(() => useTypingSender('r1'))
    act(() => result.current.onInput('a'))
    act(() => { vi.advanceTimersByTime(TYPING_THROTTLE_MS - 1) })
    act(() => result.current.onInput('ab'))
    expect(calls()).toEqual(['typing:start'])
    act(() => { vi.advanceTimersByTime(1) })
    act(() => result.current.onInput('abc'))
    expect(calls()).toEqual(['typing:start', 'typing:start'])
  })
})

describe('F07 hiển thị typing', () => {
  const start = (roomId: string, userId: string) => applyTyping({ roomId, userId, typing: true, ttlMs: 3000 })

  it('hiện ngay, tự tắt sau 3 giây không có cập nhật', () => {
    const { result } = renderHook(() => useTypingUsers('r1', 'me'))
    act(() => start('r1', 'phong'))
    expect(result.current).toEqual(['phong'])
    act(() => { vi.advanceTimersByTime(2_999) })
    expect(result.current).toEqual(['phong'])
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toEqual([])
  })

  it('typing:start mới gia hạn thêm 3 giây; typing:stop tắt ngay', () => {
    const { result } = renderHook(() => useTypingUsers('r1', 'me'))
    act(() => start('r1', 'phong'))
    act(() => { vi.advanceTimersByTime(2_000) })
    act(() => start('r1', 'phong'))
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current).toEqual(['phong'])
    act(() => applyTyping({ roomId: 'r1', userId: 'phong', typing: false, ttlMs: 3000 }))
    expect(result.current).toEqual([])
  })

  it('không lẫn sang phòng khác và bỏ qua chính mình (tab khác của mình)', () => {
    const r1 = renderHook(() => useTypingUsers('r1', 'me'))
    const r2 = renderHook(() => useTypingUsers('r2', 'me'))
    act(() => { start('r1', 'phong'); start('r1', 'me') })
    expect(r1.result.current).toEqual(['phong'])
    expect(r2.result.current).toEqual([])
  })

  it('mô tả tiếng Việt', () => {
    expect(describeTyping([])).toBeNull()
    expect(describeTyping(['Phong'])).toBe('Phong đang gõ…')
    expect(describeTyping(['Phong', 'An'])).toBe('Phong và An đang gõ…')
    expect(describeTyping(['Phong', 'An', 'Đạt'])).toBe('Nhiều người đang gõ…')
  })
})
