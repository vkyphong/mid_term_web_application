import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatTransport } from './chatApi'
import { MessageList } from './components/MessageList'
import { resetReceipts } from './receipts'
import type { ChatMessage } from './types'

vi.mock('./chatApi', () => ({ chatTransport: { request: vi.fn() } }))
const request = vi.mocked(chatTransport.request)

/** IntersectionObserver giả: test tự quyết tin nào đang nằm trong khung nhìn. */
let observed: Element[] = []
let fire: (visibleIds: string[]) => void = () => {}
class FakeObserver {
  private callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    fire = (ids) =>
      this.callback(
        observed.map((target) => ({ target, isIntersecting: ids.includes((target as HTMLElement).dataset.messageId!) })) as IntersectionObserverEntry[],
        this as unknown as IntersectionObserver,
      )
  }
  observe(el: Element) { observed.push(el) }
  disconnect() { observed = [] }
  unobserve() {}
  takeRecords() { return [] }
}

let visibility: DocumentVisibilityState = 'visible'
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

const msg = (id: string, sender = 'phong', extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, roomId: 'r1', clientMsgId: `c-${id}`, sender: { id: sender, displayName: sender }, content: `Tin ${id}`,
  createdAt: '2026-10-26T08:00:00Z', receipts: { recipients: 1, delivered: 0, seen: 0 }, ...extra,
})
const seenIds = () => request.mock.calls.filter(([t]) => t === 'message:seen').map(([, p]) => (p as { messageId: string }).messageId)

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  visibility = 'visible'
  observed = []
  resetReceipts()
  request.mockReset().mockResolvedValue({} as never)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderList = (messages: ChatMessage[]) =>
  render(<MessageList messages={messages} isPending={false} error={null} currentUserId="me" onRetry={() => {}} roomType="dm" />)

describe('F08 seen theo vùng nhìn thấy', () => {
  it('chỉ gửi seen cho tin đang nằm trong khung nhìn, không gửi cho tin của mình', async () => {
    renderList([msg('a'), msg('b'), msg('own', 'me')])
    expect(observed.map((el) => (el as HTMLElement).dataset.messageId)).toEqual(['a', 'b'])
    act(() => fire(['b']))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seenIds()).toEqual(['b'])
  })

  it('tab đang ẩn thì không gửi seen; quay lại tab thì gửi cho tin đang hiển thị', async () => {
    visibility = 'hidden'
    renderList([msg('a')])
    act(() => fire(['a']))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seenIds()).toEqual([])
    act(() => setVisibility('visible'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seenIds()).toEqual(['a'])
  })

  it('tin đã cuộn khỏi khung nhìn trước khi tab hiện lại thì không bị tính là đã xem', async () => {
    visibility = 'hidden'
    renderList([msg('a'), msg('b')])
    act(() => fire(['a']))
    act(() => fire(['b']))
    act(() => setVisibility('visible'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seenIds()).toEqual(['b'])
  })

  it('DM đã xem đủ thì không theo dõi nữa (không gửi lại khi tải lại trang)', () => {
    renderList([msg('a', 'phong', { receipts: { recipients: 1, delivered: 1, seen: 1 } })])
    expect(observed).toHaveLength(0)
  })

  it('hiển thị trạng thái dưới tin mới nhất của mình: Đã gửi → Đã nhận → Đã xem', () => {
    const own = (r: ChatMessage['receipts']) => [msg('old', 'me', { receipts: { recipients: 1, delivered: 1, seen: 1 } }), msg('new', 'me', { receipts: r })]
    const { rerender } = renderList(own({ recipients: 1, delivered: 0, seen: 0 }))
    expect(screen.getByText('Đã gửi')).toBeInTheDocument()
    expect(screen.getAllByText(/^Đã (gửi|nhận|xem)$/)).toHaveLength(1) // chỉ dưới tin mới nhất
    const props = { isPending: false, error: null, currentUserId: 'me', onRetry: () => {}, roomType: 'dm' as const }
    rerender(<MessageList messages={own({ recipients: 1, delivered: 1, seen: 0 })} {...props} />)
    expect(screen.getByText('Đã nhận')).toBeInTheDocument()
    rerender(<MessageList messages={own({ recipients: 1, delivered: 1, seen: 1 })} {...props} />)
    expect(screen.getByText('Đã xem')).toBeInTheDocument()
  })
})
