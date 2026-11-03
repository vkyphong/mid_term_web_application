import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiError'
import { setSession } from '../auth/session'
import { chatApi, chatTransport } from './chatApi'
import { ChatLayout } from './components/ChatLayout'
import type { Message, Room, ServerEvent } from './types'

vi.mock('./chatApi', () => ({
  chatApi: {
    listRooms: vi.fn(), createRoom: vi.fn(), searchUsers: vi.fn(), openDm: vi.fn(), listMessages: vi.fn(), getPresence: vi.fn(),
    listMembers: vi.fn(), addMember: vi.fn(),
  },
  chatTransport: { request: vi.fn(), onEvent: vi.fn(), onConnected: vi.fn(), isConnected: vi.fn() },
}))
vi.mock('../auth/authApi', () => ({ authApi: { logout: vi.fn() } }))
// F07 có test riêng (typing.test.ts); ở đây tắt để không lẫn typing:start vào các lệnh message:send được đếm.
vi.mock('./typing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./typing')>()),
  useTypingSender: () => ({ onInput: () => {}, onSent: () => {} }),
}))

const api = vi.mocked(chatApi)
const transport = vi.mocked(chatTransport)

const me = { id: 'u1', email: 'dat@dqgm.dev', displayName: 'Thành Đạt', role: 'user' as const }
const phong = { id: 'u2', email: 'phong@dqgm.dev', displayName: 'Phong' }

const channel = (id: string, name: string, joined: boolean, extra: Partial<Room> = {}): Room => ({
  id, type: 'channel', name, description: null, memberCount: joined ? 3 : 2, joined, peer: null, lastMessageAt: null, ...extra,
})
const eng = channel('r-eng', 'Engineering', true)
const hr = channel('r-hr', 'HR', false)
const dm: Room = { ...channel('r-dm', 'Phong', true), type: 'dm', memberCount: 2, peer: phong }

const message = (id: string, content: string, extra: Partial<Message> = {}): Message => ({
  id, roomId: eng.id, clientMsgId: null, sender: { id: phong.id, displayName: phong.displayName }, content,
  createdAt: '2026-10-21T08:00:00.000Z', ...extra,
})

let emit: (event: ServerEvent) => void

function renderChat(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setSession(queryClient, { user: me, accessToken: 'a', expiresAt: Date.now() + 900_000 })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<ChatLayout />} />
          <Route path="/rooms/:roomId" element={<ChatLayout />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  api.listRooms.mockResolvedValue([eng, hr, dm])
  api.listMessages.mockResolvedValue({ messages: [message('m1', 'Chào cả nhóm')], nextCursor: null })
  api.getPresence.mockResolvedValue([])
  api.searchUsers.mockResolvedValue([])
  api.listMembers.mockResolvedValue([])
  transport.onEvent.mockImplementation((listener) => {
    emit = listener
    return () => {}
  })
  transport.onConnected.mockReturnValue(() => {})
  transport.isConnected.mockReturnValue(true)
})

describe('danh sách phòng (F03/F04)', () => {
  it('hiện kênh đã tham gia và tin nhắn riêng, ẩn kênh chưa tham gia', async () => {
    renderChat()
    const nav = screen.getByRole('navigation', { name: 'Danh sách phòng' })
    expect(await within(nav).findByRole('link', { name: /Engineering/ })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: /Phong/ })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /HR/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Xin chào, Thành Đạt' })).toBeInTheDocument()
  })

  it('duyệt kênh và tham gia thì mở phòng đó', async () => {
    transport.request.mockResolvedValueOnce({ ...hr, joined: true, memberCount: 3 })
    const user = userEvent.setup()
    renderChat()
    await user.click(screen.getByRole('button', { name: 'Duyệt kênh' }))
    const dialog = await screen.findByRole('dialog', { name: 'Duyệt kênh' })
    await user.click(within(dialog).getByRole('button', { name: 'Tham gia HR' }))

    expect(transport.request).toHaveBeenCalledWith('room:join', { roomId: hr.id })
    expect(await screen.findByRole('heading', { level: 1, name: 'HR' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('mở kênh chưa tham gia thì hiện nút tham gia, không tải lịch sử', async () => {
    renderChat(`/rooms/${hr.id}`)
    expect(await screen.findByRole('button', { name: 'Tham gia kênh' })).toBeInTheDocument()
    expect(api.listMessages).not.toHaveBeenCalled()
  })

  it('rời kênh thì quay về màn hình tham gia', async () => {
    transport.request.mockResolvedValueOnce({ roomId: eng.id })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: 'Rời kênh' }))
    expect(transport.request).toHaveBeenCalledWith('room:leave', { roomId: eng.id })
    expect(await screen.findByRole('button', { name: 'Tham gia kênh' })).toBeInTheDocument()
  })

  it('tạo kênh: báo tên trùng, tạo được thì mở kênh mới', async () => {
    api.createRoom
      .mockRejectedValueOnce(new ApiError(409, { code: 'invalid_payload', reason: 'room_name_taken' }))
      .mockResolvedValueOnce(channel('r-new', 'Dự án Alpha', true))
    const user = userEvent.setup()
    renderChat()
    await user.click(screen.getByRole('button', { name: 'Tạo kênh' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tạo kênh mới' })
    await user.type(within(dialog).getByLabelText('Tên kênh'), 'Engineering')
    await user.click(within(dialog).getByRole('button', { name: 'Tạo kênh' }))
    expect(await within(dialog).findByText('Tên kênh đã tồn tại.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Tên kênh'))
    await user.type(within(dialog).getByLabelText('Tên kênh'), 'Dự án Alpha')
    await user.click(within(dialog).getByRole('button', { name: 'Tạo kênh' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dự án Alpha' })).toBeInTheDocument()
    expect(api.createRoom).toHaveBeenLastCalledWith({ name: 'Dự án Alpha', description: undefined })
  })
})

describe('nhóm: thêm thành viên và lưu trữ', () => {
  const an = { id: 'u3', email: 'an@dqgm.dev', displayName: 'Nguyễn An' }

  it('tạo kênh kèm thành viên: tạo xong thêm lần lượt từng người rồi mở kênh', async () => {
    api.searchUsers.mockResolvedValue([phong, an])
    const created = channel('r-new', 'Dự án Beta', true, { memberCount: 1 })
    api.createRoom.mockResolvedValueOnce(created)
    api.addMember.mockResolvedValueOnce({ ...created, memberCount: 2 }).mockResolvedValueOnce({ ...created, memberCount: 3 })
    const user = userEvent.setup()
    renderChat()
    await user.click(screen.getByRole('button', { name: 'Tạo kênh' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tạo kênh mới' })
    await user.type(within(dialog).getByLabelText('Tên kênh'), 'Dự án Beta')
    await user.click(await within(dialog).findByRole('checkbox', { name: /Phong/ }))
    await user.click(within(dialog).getByRole('checkbox', { name: /Nguyễn An/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Tạo kênh với 2 thành viên' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dự án Beta' })).toBeInTheDocument()
    expect(api.addMember.mock.calls).toEqual([[created.id, phong.id], [created.id, an.id]])
    expect(screen.getByText('3 thành viên')).toBeInTheDocument()
  })

  it('thêm thành viên vào kênh đang mở; người đã trong nhóm không chọn được', async () => {
    api.listMembers.mockResolvedValue([{ ...me, enabled: true }, { ...phong, enabled: true }])
    api.searchUsers.mockResolvedValue([phong, an])
    api.addMember.mockResolvedValueOnce({ ...eng, memberCount: 4 })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    // Có hai nút: trên đầu phòng và trên thanh công cụ soạn tin.
    expect(await screen.findAllByRole('button', { name: 'Thêm thành viên' })).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: 'Thêm thành viên' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Thêm thành viên vào #Engineering' })
    expect(await within(dialog).findByRole('checkbox', { name: /Phong/ })).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: /Nguyễn An/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Thêm 1 người' }))

    expect(api.addMember).toHaveBeenCalledWith(eng.id, an.id)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('4 thành viên')).toBeInTheDocument()
  })

  it('kênh đã lưu trữ: xem được lịch sử nhưng không có ô soạn tin hay nút thêm người', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, archived: true }])
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Chào cả nhóm')).toBeInTheDocument()
    expect(screen.getByText('Đã lưu trữ')).toBeInTheDocument()
    expect(screen.getByText(/Nhóm đã được lưu trữ/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nội dung tin nhắn')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thêm thành viên' })).not.toBeInTheDocument()
  })

  it('kênh lưu trữ chưa tham gia thì không có nút tham gia', async () => {
    api.listRooms.mockResolvedValue([{ ...hr, archived: true }])
    renderChat(`/rooms/${hr.id}`)
    expect(await screen.findByText('Kênh đã được lưu trữ nên không thể tham gia.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tham gia kênh' })).not.toBeInTheDocument()
  })
})

describe('tin nhắn', () => {
  it('gửi: hiện "Đang gửi…" rồi thành tin thật; ack + message:new không bị trùng', async () => {
    let ack!: (m: Message) => void
    transport.request.mockImplementationOnce(() => new Promise((resolve) => { ack = resolve as (m: Message) => void }))
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Chào cả nhóm')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Nội dung tin nhắn'), 'Họp lúc 3h nhé{Enter}')
    expect(await screen.findByText('Họp lúc 3h nhé')).toBeInTheDocument()
    expect(screen.getByText('Đang gửi…')).toBeInTheDocument()
    expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveValue('')

    const [, payload] = transport.request.mock.calls[0] as [string, { clientMsgId: string }]
    expect(transport.request).toHaveBeenCalledWith('message:send', expect.objectContaining({ roomId: eng.id, content: 'Họp lúc 3h nhé' }))
    const confirmed = message('m2', 'Họp lúc 3h nhé', {
      clientMsgId: payload.clientMsgId, sender: { id: me.id, displayName: me.displayName }, createdAt: '2026-10-21T08:05:00.000Z',
    })
    await act(async () => ack(confirmed))
    act(() => emit({ type: 'message:new', payload: confirmed, ts: '' }))

    await waitFor(() => expect(screen.queryByText('Đang gửi…')).not.toBeInTheDocument())
    expect(screen.getAllByText('Họp lúc 3h nhé')).toHaveLength(1)
  })

  it('gửi lỗi (bị từ chối) thì báo lý do và cho thử lại với cùng clientMsgId', async () => {
    transport.request
      .mockRejectedValueOnce(new ApiError(403, { code: 'forbidden' }))
      .mockImplementationOnce(() => new Promise(() => {}))
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await screen.findByText('Chào cả nhóm')
    await user.type(screen.getByLabelText('Nội dung tin nhắn'), 'Xin chào{Enter}')

    expect(await screen.findByText(/Bạn không có quyền trong phòng này/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Thử lại' }))
    const ids = transport.request.mock.calls.map(([, p]) => (p as { clientMsgId: string }).clientMsgId)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
    expect(await screen.findByText('Đang gửi…')).toBeInTheDocument()
  })

  it('nhận tin realtime của người khác trong phòng đang mở', async () => {
    renderChat(`/rooms/${eng.id}`)
    await screen.findByText('Chào cả nhóm')
    act(() => emit({ type: 'message:new', payload: message('m3', 'Tin mới từ Phong', { createdAt: '2026-10-21T08:10:00.000Z' }), ts: '' }))
    expect(await screen.findByText('Tin mới từ Phong')).toBeInTheDocument()
  })

  it('tin của phòng chưa biết (DM mới) thì tải lại danh sách phòng', async () => {
    renderChat()
    await screen.findByRole('link', { name: /Engineering/ })
    expect(api.listRooms).toHaveBeenCalledTimes(1)
    act(() => emit({ type: 'message:new', payload: message('m4', 'hi', { roomId: 'r-moi' }), ts: '' }))
    await waitFor(() => expect(api.listRooms).toHaveBeenCalledTimes(2))
  })

  it('khoá ô soạn tin khi lịch sử chưa tải xong', async () => {
    let load!: (page: { messages: Message[]; nextCursor: null }) => void
    api.listMessages.mockImplementationOnce(() => new Promise((resolve) => { load = resolve }))
    renderChat(`/rooms/${eng.id}`)
    const box = await screen.findByLabelText('Nội dung tin nhắn')
    expect(box).toBeDisabled()
    await act(async () => load({ messages: [], nextCursor: null }))
    await waitFor(() => expect(box).toBeEnabled())
  })

  it('không gửi tin rỗng; Shift+Enter xuống dòng', async () => {
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await screen.findByText('Chào cả nhóm')
    const box = screen.getByLabelText('Nội dung tin nhắn')
    await user.type(box, '   {Enter}')
    await user.type(box, 'dòng 1{Shift>}{Enter}{/Shift}dòng 2')
    expect(transport.request).not.toHaveBeenCalled()
    expect(box).toHaveValue('   dòng 1\ndòng 2')
  })
})

describe('được thêm vào nhóm', () => {
  it('room:added: nhóm hiện ngay trong danh sách kèm thông báo, bấm thông báo mở nhóm', async () => {
    const user = userEvent.setup()
    renderChat()
    const nav = screen.getByRole('navigation', { name: 'Danh sách phòng' })
    expect(await within(nav).findByRole('link', { name: /Engineering/ })).toBeInTheDocument()
    const added = channel('r-added', 'Dự án Gamma', true, { memberCount: 3 })

    act(() => emit({ type: 'room:added', payload: added, ts: '' }))
    expect(await within(nav).findByRole('link', { name: /Dự án Gamma/ })).toBeInTheDocument()
    expect(api.listRooms).toHaveBeenCalledTimes(1) // không cần tải lại danh sách
    await user.click(screen.getByRole('button', { name: /Bạn đã được thêm vào nhóm/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dự án Gamma' })).toBeInTheDocument()
  })
})

describe('số tin chưa đọc', () => {
  it('tin đến phòng khác hiện vòng tròn đỏ có số, từ 5 tin là "5+", mở phòng thì mất', async () => {
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Chào cả nhóm')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Danh sách phòng' })
    const dmLink = within(nav).getByRole('link', { name: /Phong/ })
    const dmMessage = (i: number) =>
      message(`d${i}`, `Tin riêng ${i}`, { roomId: dm.id, createdAt: `2026-10-21T09:0${i}:00.000Z` })

    act(() => emit({ type: 'message:new', payload: dmMessage(1), ts: '' }))
    act(() => emit({ type: 'message:new', payload: dmMessage(1), ts: '' })) // sự kiện lặp không đếm thêm
    const badge = () => dmLink.querySelector('.unread-badge')
    expect(dmLink).toHaveAccessibleName('Phong')
    expect(dmLink).toHaveAccessibleDescription('1 tin chưa đọc')
    expect(badge()).toHaveTextContent('1')
    expect(document.title).toBe('(1) Tập Đoàn M Chat')

    for (const i of [2, 3, 4, 5, 6]) act(() => emit({ type: 'message:new', payload: dmMessage(i), ts: '' }))
    expect(dmLink).toHaveAccessibleDescription('6 tin chưa đọc')
    expect(badge()).toHaveTextContent('5+')

    // Tin ở phòng đang xem không bị đếm.
    act(() => emit({ type: 'message:new', payload: message('e1', 'Ở phòng đang mở', { createdAt: '2026-10-21T09:10:00.000Z' }), ts: '' }))
    expect(within(nav).getByRole('link', { name: /Engineering/ }).querySelector('.unread-badge')).toBeNull()

    await user.click(dmLink)
    await waitFor(() => expect(badge()).toBeNull())
    expect(dmLink).not.toHaveAttribute('aria-describedby')
    expect(document.title).toBe('Tập Đoàn M Chat')
  })

  it('nút loa bật/tắt âm thanh thông báo', async () => {
    const user = userEvent.setup()
    renderChat()
    await user.click(screen.getByRole('button', { name: 'Tắt âm thanh thông báo' }))
    expect(screen.getByRole('button', { name: 'Bật âm thanh thông báo' })).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('pulsechat:sound-muted')).toBe('1')
  })
})

describe('tin nhắn riêng (F04)', () => {
  it('tìm nhân viên rồi mở cuộc trò chuyện riêng', async () => {
    api.searchUsers.mockResolvedValue([phong])
    api.openDm.mockResolvedValueOnce(dm)
    const user = userEvent.setup()
    renderChat()
    await user.click(screen.getByRole('button', { name: 'Tin nhắn mới' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tin nhắn mới' })
    await user.type(within(dialog).getByLabelText('Tìm nhân viên'), 'pho')
    await waitFor(() => expect(api.searchUsers).toHaveBeenLastCalledWith('pho'))
    await user.click(await within(dialog).findByRole('button', { name: /Phong/ }))

    expect(api.openDm).toHaveBeenCalledWith(phong.id)
    expect(await screen.findByRole('heading', { level: 1, name: 'Phong' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nội dung tin nhắn')).toHaveAttribute('placeholder', 'Nhập tin nhắn tới Phong')
    expect(screen.queryByRole('button', { name: 'Rời kênh' })).not.toBeInTheDocument()
  })
})

describe('lịch sử tin nhắn (F05)', () => {
  const page = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, k) => {
      const i = from + k
      return message(`m${String(i).padStart(2, '0')}`, `Tin số ${i}`, { createdAt: `2026-10-21T08:${String(i).padStart(2, '0')}:00.000Z` })
    })
  const shown = () => screen.getAllByText(/^Tin số \d+$/).map((el) => Number(el.textContent!.replace('Tin số ', '')))

  it('tải thêm tin cũ theo cursor cho tới khi hết, không trùng và đúng thứ tự', async () => {
    api.listMessages.mockReset()
    api.listMessages
      .mockResolvedValueOnce({ messages: page(31, 60), nextCursor: 'c31' })
      .mockResolvedValueOnce({ messages: page(1, 30), nextCursor: null })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Tin số 60')).toBeInTheDocument()
    expect(shown()).toHaveLength(30)
    expect(screen.queryByText('Đã hiển thị toàn bộ lịch sử')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }))
    expect(api.listMessages).toHaveBeenLastCalledWith(eng.id, 'c31')
    expect(await screen.findByText('Tin số 1')).toBeInTheDocument()
    expect(shown()).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
    expect(screen.getByText('Đã hiển thị toàn bộ lịch sử')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tải tin cũ hơn' })).not.toBeInTheDocument()
  })

  it('tin mới đến trong lúc đang tải tin cũ vẫn hiện, gộp theo ID', async () => {
    let older!: (p: { messages: Message[]; nextCursor: null }) => void
    api.listMessages.mockReset()
    api.listMessages
      .mockResolvedValueOnce({ messages: page(31, 60), nextCursor: 'c31' })
      .mockImplementationOnce(() => new Promise((resolve) => { older = resolve }))
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await screen.findByText('Tin số 60')
    await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }))
    expect(screen.getByRole('button', { name: 'Đang tải tin cũ…' })).toBeDisabled()

    act(() => emit({ type: 'message:new', payload: page(61, 61)[0], ts: '' }))
    // Trang cũ trả về có lẫn một tin đã có (m31) → không bị nhân đôi.
    await act(async () => older({ messages: [...page(1, 30), ...page(31, 31)], nextCursor: null }))
    await waitFor(() => expect(shown()).toEqual(Array.from({ length: 61 }, (_, i) => i + 1)))
  })

  it('tải tin cũ lỗi thì báo và cho thử lại', async () => {
    api.listMessages.mockReset()
    api.listMessages
      .mockResolvedValueOnce({ messages: page(31, 60), nextCursor: 'c31' })
      .mockRejectedValueOnce(new ApiError(0, { code: 'network_error' }))
      .mockResolvedValueOnce({ messages: page(1, 30), nextCursor: null })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await screen.findByText('Tin số 60')
    await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }))
    await user.click(await screen.findByRole('button', { name: 'Thử lại' }))
    expect(await screen.findByText('Tin số 1')).toBeInTheDocument()
    expect(api.listMessages).toHaveBeenLastCalledWith(eng.id, 'c31')
  })
})
