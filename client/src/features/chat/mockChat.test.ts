import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockChat } from './mockChat'

vi.mock('../auth/mockAuthApi', () => ({
  getMockCurrentUser: () => JSON.parse(sessionStorage.getItem('test.user') ?? 'null'),
  listMockUsers: () => [
    { id: 'u1', email: 'dat@dqgm.dev', displayName: 'Đạt' },
    { id: 'u2', email: 'phong@dqgm.dev', displayName: 'Phong' },
    { id: 'u3', email: 'an@dqgm.dev', displayName: 'An' },
  ],
}))

const as = (id: string) => sessionStorage.setItem('test.user', JSON.stringify({ id, displayName: id, email: `${id}@dqgm.dev` }))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  as('u1')
})

describe('mock chat (theo docs/api/chat.md)', () => {
  it('có sẵn 4 kênh mẫu', async () => {
    const { api } = createMockChat()
    const names = (await api.listRooms()).map((r) => r.name)
    expect(names).toEqual(['Engineering', 'HR', 'Sales', 'Marketing'])
  })

  it('phải tham gia kênh mới gửi được và xem được lịch sử', async () => {
    const { api, transport } = createMockChat()
    const [eng] = await api.listRooms()
    await expect(transport.request('message:send', { roomId: eng.id, content: 'hi', clientMsgId: 'c1' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(api.listMessages(eng.id)).rejects.toMatchObject({ code: 'forbidden' })
    await transport.request('room:join', { roomId: eng.id })
    const sent = await transport.request('message:send', { roomId: eng.id, content: ' hi ', clientMsgId: 'c1' })
    expect(sent.content).toBe('hi')
    expect((await api.listMessages(eng.id)).messages).toHaveLength(1)
  })

  it('gửi lại cùng clientMsgId không tạo trùng', async () => {
    const { api, transport } = createMockChat()
    const [eng] = await api.listRooms()
    await transport.request('room:join', { roomId: eng.id })
    const a = await transport.request('message:send', { roomId: eng.id, content: 'x', clientMsgId: 'same' })
    const b = await transport.request('message:send', { roomId: eng.id, content: 'x', clientMsgId: 'same' })
    expect(b.id).toBe(a.id)
  })

  it('DM chỉ có hai thành viên, mở lại trả cùng phòng, người thứ ba bị từ chối', async () => {
    const { api, transport } = createMockChat()
    const dm = await api.openDm('u2')
    expect(dm).toMatchObject({ type: 'dm', name: 'Phong', memberCount: 2 })
    as('u2')
    expect((await api.openDm('u1')).id).toBe(dm.id)
    as('u3')
    await expect(transport.request('message:send', { roomId: dm.id, content: 'x', clientMsgId: 'c' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(api.listMessages(dm.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(transport.request('room:join', { roomId: dm.id })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await api.listRooms()).some((r) => r.id === dm.id)).toBe(false)
  })

  it('chỉ thành viên nhận message:new; rời kênh thì không nhận nữa', async () => {
    const { api, transport } = createMockChat()
    const [eng] = await api.listRooms()
    const received = vi.fn()
    transport.onEvent(received)
    await transport.request('room:join', { roomId: eng.id })
    await transport.request('message:send', { roomId: eng.id, content: '1', clientMsgId: 'a' })
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    await transport.request('room:leave', { roomId: eng.id })
    // u2 gửi vào kênh mà u1 vừa rời: tab của u1 không được nhận.
    as('u2')
    await transport.request('room:join', { roomId: eng.id })
    await transport.request('message:send', { roomId: eng.id, content: '2', clientMsgId: 'b' })
    as('u1')
    await new Promise((r) => setTimeout(r, 10))
    expect(received).toHaveBeenCalledTimes(1)
  })

  it('phân trang lịch sử bằng cursor: 30 tin/lần, không trùng, không thiếu (F05)', async () => {
    const { api, transport } = createMockChat()
    const [eng] = await api.listRooms()
    await transport.request('room:join', { roomId: eng.id })
    // Ghi thẳng 65 tin vào store cho nhanh (cùng một timestamp để kiểm tra thứ tự ổn định).
    const store = JSON.parse(localStorage.getItem('pulsechat.mock.chat')!)
    store.messages[eng.id] = Array.from({ length: 65 }, (_, i) => ({
      id: `m${String(i + 1).padStart(2, '0')}`, roomId: eng.id, clientMsgId: `c${i}`,
      sender: { id: 'u1', displayName: 'u1' }, content: `#${i + 1}`, createdAt: '2026-10-26T08:00:00Z',
    }))
    localStorage.setItem('pulsechat.mock.chat', JSON.stringify(store))

    const pages = [await api.listMessages(eng.id)]
    while (pages[pages.length - 1].nextCursor) pages.push(await api.listMessages(eng.id, pages[pages.length - 1].nextCursor!))
    expect(pages.map((p) => p.messages.length)).toEqual([30, 30, 5])
    const ids = pages.reverse().flatMap((p) => p.messages.map((m) => m.id))
    expect(ids).toEqual(Array.from({ length: 65 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`))
    await expect(api.listMessages(eng.id, 'không-tồn-tại')).rejects.toMatchObject({ code: 'invalid_payload' })
  })

  it('tên kênh trùng (không phân biệt hoa thường) bị từ chối', async () => {
    const { api } = createMockChat()
    await expect(api.createRoom({ name: 'engineering' })).rejects.toMatchObject({ reason: 'room_name_taken' })
    const room = await api.createRoom({ name: 'Dự án Alpha' })
    expect(room).toMatchObject({ type: 'channel', joined: true, memberCount: 1 })
  })
})
