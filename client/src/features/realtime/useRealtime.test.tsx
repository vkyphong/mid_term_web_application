import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtime } from './useRealtime'
import { tokenStore } from '../../lib/tokenStore'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'user' }, accessToken: 'access-1', expiresAt: Date.now() + 900000 },
  refresh: vi.fn(),
  clients: [] as Array<{
    options: Record<string, (...args: never[]) => void>
    activate: ReturnType<typeof vi.fn>
    deactivate: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    publish: ReturnType<typeof vi.fn>
    reconnectDelay: number
    connectHeaders: Record<string, string>
  }>,
}))
vi.mock('../auth/hooks', () => ({ useSession: () => ({ session: mocks.session }) }))
vi.mock('../../lib/apiClient', () => ({ refreshAccessToken: mocks.refresh }))
vi.mock('@stomp/stompjs', () => ({ Client: class {
  options: Record<string, (...args: never[]) => void>
  activate = vi.fn()
  deactivate = vi.fn().mockResolvedValue(undefined)
  subscribe = vi.fn()
  publish = vi.fn()
  reconnectDelay = 3000
  connectHeaders = {}
  constructor(options: Record<string, (...args: never[]) => void>) { this.options = options; mocks.clients.push(this) }
} }))

beforeEach(() => { mocks.clients.length = 0; mocks.refresh.mockReset().mockResolvedValue('fresh'); tokenStore.set('access-1') })
describe('realtime lifecycle', () => {
  it('waits for the previous socket to close before reconnecting with a refreshed token', async () => {
    const { rerender } = renderHook(() => useRealtime())
    await act(async () => { await Promise.resolve() })
    expect(mocks.clients[0].activate).toHaveBeenCalledOnce()
    let closed!: () => void
    mocks.clients[0].deactivate.mockImplementationOnce(() => new Promise<void>((resolve) => { closed = resolve }))
    mocks.session = { ...mocks.session, accessToken: 'refreshed' }
    rerender()
    expect(mocks.clients[1].activate).not.toHaveBeenCalled()
    await act(async () => { closed(); await Promise.resolve() })
    expect(mocks.clients[1].activate).toHaveBeenCalledOnce()
  })
  it('uses the current token and a private authenticated probe', () => {
    const { result, unmount } = renderHook(() => useRealtime())
    const client = mocks.clients[0]
    act(() => client.options.beforeConnect())
    expect(client.connectHeaders).toEqual({ Authorization: 'Bearer access-1' })
    act(() => client.options.onConnect())
    expect(result.current.state).toBe('connected')
    expect(client.subscribe).toHaveBeenCalledWith('/user/queue/session', expect.any(Function))
    expect(client.publish).toHaveBeenCalledWith({ destination: '/app/session/ping', body: '{}' })
    unmount()
    expect(client.deactivate).toHaveBeenCalled()
  })
  it('does not retry or refresh after hitting the connection cap', () => {
    const { result } = renderHook(() => useRealtime())
    const client = mocks.clients[0]
    act(() => client.options.onStompError({ headers: { message: 'rate_limited' }, body: '' } as never))
    act(() => client.options.onWebSocketClose({ code: 1002 } as never))
    expect(result.current.state).toBe('limited')
    expect(client.reconnectDelay).toBe(0)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
  it('only refreshes once across repeated auth failures after token replacement', () => {
    const { rerender } = renderHook(() => useRealtime())
    act(() => mocks.clients[0].options.onStompError({ headers: { message: 'unauthorized' }, body: '' } as never))
    mocks.session = { ...mocks.session, accessToken: 'access-2' }
    rerender()
    act(() => mocks.clients[1].options.onStompError({ headers: { message: 'unauthorized' }, body: '' } as never))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
  it('stops network reconnects after five failed attempts', () => {
    renderHook(() => useRealtime())
    const client = mocks.clients[0]
    act(() => { for (let i = 0; i < 5; i++) client.options.onWebSocketClose({ code: 1006 } as never) })
    expect(client.reconnectDelay).toBe(0)
    expect(client.deactivate).toHaveBeenCalled()
  })
})
