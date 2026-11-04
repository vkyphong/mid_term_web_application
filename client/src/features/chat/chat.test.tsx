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
    listMembers: vi.fn(), addMember: vi.fn(), listNotifications: vi.fn(),
    renameRoom: vi.fn(), setNickname: vi.fn(), uploadRoomAvatar: vi.fn(), removeRoomAvatar: vi.fn(), downloadFile: vi.fn(),
    listUserAvatars: vi.fn(), uploadMyAvatar: vi.fn(), removeMyAvatar: vi.fn(), searchMessages: vi.fn(), setMemberRole: vi.fn(),
    createPoll: vi.fn(), vote: vi.fn(), getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getUserProfile: vi.fn(), closePoll: vi.fn(),
    updateRoomSettings: vi.fn(), listMemberRequests: vi.fn(), decideMemberRequest: vi.fn(),
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
  api.listUserAvatars.mockResolvedValue([])
  api.listNotifications.mockResolvedValue({ notifications: [], nextCursor: null, unreadCount: 0 })
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

describe('bình chọn, tìm tin, phân quyền, ảnh đại diện', () => {
  const an = { id: 'u3', email: 'an@dqgm.dev', displayName: 'Nguyễn An' }
  const pollMessage = (voters: string[] = []): Message =>
    message('p1', '📊 Ăn trưa ở đâu?', {
      sender: { id: me.id, displayName: me.displayName },
      poll: {
        id: 'poll-1', question: 'Ăn trưa ở đâu?', multiple: true, createdBy: me.id,
        options: [{ id: 'o1', label: 'Cơm', voters }, { id: 'o2', label: 'Phở', voters: [] }],
      },
    })

  it('tạo bình chọn: 2 lựa chọn ban đầu, bấm + để thêm; bình chọn hiện trong khung chat và bấm để chọn', async () => {
    api.createPoll.mockResolvedValueOnce(pollMessage())
    api.vote.mockResolvedValueOnce(pollMessage([me.id]))
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: 'Tạo bình chọn' }))
    const dialog = screen.getByRole('dialog', { name: 'Tạo bình chọn' })
    expect(within(dialog).getAllByLabelText(/^Lựa chọn \d$/)).toHaveLength(2)
    await user.type(within(dialog).getByLabelText('Câu hỏi'), 'Ăn trưa ở đâu?')
    await user.type(within(dialog).getByLabelText('Lựa chọn 1'), 'Cơm')
    await user.click(within(dialog).getByRole('button', { name: 'Tạo bình chọn' }))
    expect(within(dialog).getByText('Cần ít nhất 2 lựa chọn.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '+ Thêm lựa chọn' }))
    expect(within(dialog).getAllByLabelText(/^Lựa chọn \d$/)).toHaveLength(3)
    await user.type(within(dialog).getByLabelText('Lựa chọn 2'), 'Phở')
    await user.click(within(dialog).getByRole('button', { name: 'Tạo bình chọn' }))
    expect(api.createPoll).toHaveBeenCalledWith(eng.id, { question: 'Ăn trưa ở đâu?', options: ['Cơm', 'Phở'], multiple: true })

    const poll = await screen.findByRole('group', { name: 'Bình chọn: Ăn trưa ở đâu?' })
    await user.click(within(poll).getByRole('checkbox', { name: 'Cơm: 0 phiếu' }))
    expect(api.vote).toHaveBeenCalledWith('poll-1', ['o1'])
    expect(await within(poll).findByRole('checkbox', { name: 'Cơm: 1 phiếu' })).toHaveAttribute('aria-checked', 'true')
    // Bình chọn của người khác cập nhật realtime.
    act(() => emit({ type: 'message:poll', payload: pollMessage([me.id, phong.id]), ts: '' }))
    expect(await within(poll).findByRole('checkbox', { name: 'Cơm: 2 phiếu' })).toBeInTheDocument()
  })

  it('tìm tin nhắn: gõ từ khoá ra kết quả, chọn kết quả thì tải lịch sử cũ tới tin đó và tô sáng', async () => {
    const old = message('old-1', 'Báo cáo quý 1 đã xong', { createdAt: '2026-10-01T08:00:00.000Z' })
    api.listMessages.mockResolvedValueOnce({ messages: [message('m1', 'Chào cả nhóm')], nextCursor: 'c1' })
    api.listMessages.mockResolvedValueOnce({ messages: [old], nextCursor: null })
    api.searchMessages.mockResolvedValue({ messages: [old], nextCursor: null })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Chào cả nhóm')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tìm tin nhắn' }))
    // Ô tìm nằm ngay trong đầu phòng, cạnh icon, không phải hộp thoại.
    expect(screen.getByRole('search', { name: 'Tìm tin nhắn' }).closest('header')).toHaveClass('room-header')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Từ khoá'), 'báo cáo')
    await waitFor(() => expect(api.searchMessages).toHaveBeenCalledWith(eng.id, 'báo cáo', undefined))
    const result = await screen.findByRole('button', { name: /Báo cáo quý 1/ })
    expect(within(result).getByText('Báo cáo').tagName).toBe('MARK')
    await user.click(result)
    expect(api.listMessages).toHaveBeenLastCalledWith(eng.id, 'c1')
    await waitFor(() => expect(document.getElementById('message-old-1')).toHaveClass('message--highlight'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('trưởng nhóm có chìa khoá, bổ nhiệm phó nhóm; người khác chỉ xem', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, myRole: 'owner', memberCount: 3 }])
    api.listMembers.mockResolvedValue([
      { ...me, enabled: true, memberRole: 'owner' }, { ...phong, enabled: true, memberRole: 'member' }, { ...an, enabled: true, memberRole: 'member' },
    ])
    api.setMemberRole.mockResolvedValueOnce([
      { ...me, enabled: true, memberRole: 'owner' }, { ...phong, enabled: true, memberRole: 'deputy' }, { ...an, enabled: true, memberRole: 'member' },
    ])
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: '3 thành viên' }))
    const dialog = screen.getByRole('dialog', { name: 'Thành viên (3)' })
    expect(await within(dialog).findByText('Trưởng nhóm')).toBeInTheDocument()
    expect(dialog.querySelector('.role-key--owner')).not.toBeNull()
    const phongRow = within(dialog).getByText('Phong').closest('li')!
    await user.click(within(phongRow).getByRole('button', { name: 'Bổ nhiệm phó nhóm' }))
    expect(api.setMemberRole).toHaveBeenCalledWith(eng.id, phong.id, 'deputy')
    expect(await within(phongRow).findByText('Phó nhóm')).toBeInTheDocument()
    expect(phongRow.querySelector('.role-key--deputy')).not.toBeNull()
    expect(within(phongRow).getByRole('button', { name: 'Bỏ phó nhóm' })).toBeInTheDocument()
  })

  it('thông tin tài khoản: xem giới tính, ngày sinh, điện thoại; Cập nhật thì đổi luôn tên ở đầu trang', async () => {
    const base = { id: me.id, email: me.email, displayName: me.displayName, avatarUrl: null, profilePublic: false }
    api.getMyProfile.mockResolvedValue({ ...base, gender: 'male', birthDate: '2006-05-18', phone: null })
    api.updateMyProfile.mockResolvedValueOnce({ ...base, displayName: 'Võ Thành Đạt', gender: 'male', birthDate: '2006-05-18', phone: '0901 234 567' })
    const user = userEvent.setup()
    renderChat()
    await user.click(await screen.findByRole('button', { name: 'Thông tin tài khoản' }))
    const dialog = screen.getByRole('dialog', { name: 'Thông tin tài khoản' })
    expect(await within(dialog).findByText('Nam')).toBeInTheDocument()
    expect(within(dialog).getByText('18 tháng 05, 2006')).toBeInTheDocument()
    expect(within(dialog).getByText('dat@dqgm.dev')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '✏️ Cập nhật' }))
    await user.clear(within(dialog).getByLabelText('Tên hiển thị'))
    await user.type(within(dialog).getByLabelText('Tên hiển thị'), 'Võ Thành Đạt')
    await user.type(within(dialog).getByLabelText('Điện thoại'), '0901 234 567')
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(api.updateMyProfile).toHaveBeenCalledWith({ displayName: 'Võ Thành Đạt', gender: 'male', birthDate: '2006-05-18', phone: '0901 234 567', profilePublic: false })
    expect(await within(dialog).findByText('0901 234 567')).toBeInTheDocument()
    expect(screen.getByText('Võ Thành Đạt', { selector: '.chat-user-name' })).toBeInTheDocument()
  })

  it('bình chọn của người khác nằm giữa, có tên người tạo; bình chọn của mình không có dòng này', async () => {
    const theirs = message('p2', '📊 Họp ngày nào?', {
      poll: { id: 'poll-2', question: 'Họp ngày nào?', multiple: false, createdBy: phong.id, options: [{ id: 'a', label: 'T2', voters: [] }, { id: 'b', label: 'T4', voters: [] }] },
    })
    api.listMessages.mockResolvedValue({ messages: [theirs, pollMessage()], nextCursor: null })
    renderChat(`/rooms/${eng.id}`)
    const polls = await screen.findAllByRole('group', { name: /Bình chọn/ })
    expect(polls).toHaveLength(2)
    expect(polls[0].closest('li')).toHaveClass('message--poll')
    expect(polls[0].closest('li')).toHaveTextContent('Phong đã tạo cuộc bình chọn')
    expect(polls[1].closest('li')).not.toHaveTextContent('đã tạo cuộc bình chọn')
    expect(within(polls[0]).getAllByRole('radio')).toHaveLength(2)
  })

  it('chọn công khai / riêng tư; xem hồ sơ người khác: riêng tư thì ẩn thông tin cá nhân', async () => {
    const base = { id: me.id, email: me.email, displayName: me.displayName, avatarUrl: null, gender: null, birthDate: null, phone: null }
    api.getMyProfile.mockResolvedValue({ ...base, profilePublic: false })
    api.updateMyProfile.mockResolvedValueOnce({ ...base, profilePublic: true })
    api.getUserProfile.mockResolvedValueOnce({ id: phong.id, email: phong.email, displayName: 'Phong', avatarUrl: null, gender: null, birthDate: null, phone: null, profilePublic: false, self: false })
    const user = userEvent.setup()
    renderChat(`/rooms/${dm.id}`)
    await user.click(await screen.findByRole('button', { name: 'Thông tin tài khoản' }))
    const dialog = screen.getByRole('dialog', { name: 'Thông tin tài khoản' })
    expect(await within(dialog).findByText('🔒 Riêng tư')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '✏️ Cập nhật' }))
    await user.click(within(dialog).getByLabelText('🌐 Công khai'))
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(api.updateMyProfile).toHaveBeenLastCalledWith(expect.objectContaining({ profilePublic: true }))
    expect(await within(dialog).findByText('🌐 Công khai')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }))

    // Bấm avatar người kia ở đầu chat 1:1 → hồ sơ riêng tư: không có giới tính / ngày sinh / điện thoại.
    await user.click(within(document.querySelector<HTMLElement>('.room-header')!).getByRole('button', { name: 'Xem thông tin Phong' }))
    expect(api.getUserProfile).toHaveBeenCalledWith(phong.id)
    const other = await screen.findByRole('dialog', { name: 'Thông tin tài khoản' })
    expect(await within(other).findByText(/Phong để thông tin cá nhân ở chế độ riêng tư/)).toBeInTheDocument()
    expect(within(other).queryByText('Giới tính')).not.toBeInTheDocument()
  })

  it('khoá bình chọn: người tạo / trưởng / phó nhóm thấy nút; khoá xong không bình chọn được; dòng hoạt động có nút Xem', async () => {
    const theirs = (closedAt: string | null = null): Message => message('p3', '📊 Họp T7?', {
      poll: { id: 'poll-3', question: 'Họp T7?', multiple: true, createdBy: phong.id, closedAt, options: [{ id: 'a', label: '20h', voters: [] }, { id: 'b', label: '21h', voters: [] }] },
    })
    const line = message('act-1', 'Họp T7?', { sender: { id: an.id, displayName: an.displayName }, activity: { type: 'vote', pollId: 'poll-3', pollMessageId: 'p3' } })
    api.listMessages.mockResolvedValue({ messages: [theirs(), line], nextCursor: null })
    // Mình là thành viên thường → không thấy nút khoá.
    api.listMembers.mockResolvedValue([{ ...me, enabled: true, memberRole: 'member' }, { ...phong, enabled: true, memberRole: 'owner' }])
    const user = userEvent.setup()
    const view = renderChat(`/rooms/${eng.id}`)
    const poll = await screen.findByRole('group', { name: 'Bình chọn: Họp T7?' })
    await waitFor(() => expect(api.listMembers).toHaveBeenCalled())
    expect(within(poll).queryByRole('button', { name: '🔒 Khoá bình chọn' })).not.toBeInTheDocument()
    const activity = document.querySelector<HTMLElement>('.activity-line')!
    expect(activity).toHaveTextContent('Nguyễn An đã bình chọn: Họp T7?')
    await user.click(within(activity).getByRole('button', { name: 'Xem' }))
    await waitFor(() => expect(document.getElementById('message-p3')).toHaveClass('message--highlight'))
    view.unmount()

    // Phó nhóm → có nút khoá; khoá xong các lựa chọn bị vô hiệu.
    api.listMembers.mockResolvedValue([{ ...me, enabled: true, memberRole: 'deputy' }, { ...phong, enabled: true, memberRole: 'owner' }])
    api.closePoll.mockResolvedValueOnce(theirs('2026-11-04T10:00:00Z'))
    renderChat(`/rooms/${eng.id}`)
    const poll2 = await screen.findByRole('group', { name: 'Bình chọn: Họp T7?' })
    await user.click(await within(poll2).findByRole('button', { name: '🔒 Khoá bình chọn' }))
    expect(api.closePoll).toHaveBeenCalledWith('poll-3')
    expect(await within(poll2).findByText(/Đã khoá bình chọn/)).toBeInTheDocument()
    expect(within(poll2).getByRole('checkbox', { name: '20h: 0 phiếu' })).toBeDisabled()
    expect(within(poll2).queryByRole('button', { name: '🔒 Khoá bình chọn' })).not.toBeInTheDocument()
  })

  it('chìa khoá: trưởng nhóm vàng, phó nhóm bạc', async () => {
    api.listMessages.mockResolvedValue({
      messages: [message('k1', 'trưởng nhóm nói'), message('k2', 'phó nhóm nói', { sender: { id: an.id, displayName: an.displayName } })],
      nextCursor: null,
    })
    api.listMembers.mockResolvedValue([{ ...phong, enabled: true, memberRole: 'owner' }, { ...an, enabled: true, memberRole: 'deputy' }, { ...me, enabled: true, memberRole: 'member' }])
    renderChat(`/rooms/${eng.id}`)
    const owner = (await screen.findByText('trưởng nhóm nói')).closest('li')!
    await waitFor(() => expect(owner.querySelector('.role-key--owner svg')).not.toBeNull())
    expect(screen.getByText('phó nhóm nói').closest('li')!.querySelector('.role-key--deputy svg')).not.toBeNull()
  })

  it('phê duyệt thành viên mới: thành viên thường thêm người thì gửi yêu cầu chờ duyệt', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, myRole: 'member', requireApproval: true, memberCount: 3 }])
    api.listMembers.mockResolvedValue([{ ...me, enabled: true, memberRole: 'member' }])
    api.searchUsers.mockResolvedValue([an])
    api.addMember.mockResolvedValueOnce({
      pending: true,
      request: { id: 'rq1', user: an, requestedBy: me, createdAt: '2026-11-04T09:00:00Z' },
      room: { ...eng, myRole: 'member', requireApproval: true, memberCount: 3 },
    })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click((await screen.findAllByRole('button', { name: 'Thêm thành viên' }))[0])
    const dialog = screen.getByRole('dialog', { name: /Thêm thành viên vào/ })
    expect(within(dialog).getByText(/Nhóm đang bật phê duyệt/)).toBeInTheDocument()
    await user.click(await within(dialog).findByRole('checkbox', { name: /Nguyễn An/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu thêm 1 người' }))
    expect(await screen.findByText('Đã gửi yêu cầu thêm thành viên')).toBeInTheDocument()
    expect(screen.getByText('1 người đang chờ trưởng nhóm / phó nhóm duyệt.')).toBeInTheDocument()
    expect(screen.getByText('3 thành viên')).toBeInTheDocument() // chưa vào nhóm
  })

  it('trưởng nhóm bật phê duyệt và duyệt / từ chối yêu cầu; đầu phòng báo số chờ duyệt', async () => {
    const request = { id: 'rq1', user: an, requestedBy: phong, createdAt: '2026-11-04T09:00:00Z' }
    api.listRooms.mockResolvedValue([{ ...eng, myRole: 'owner', requireApproval: false, pendingRequests: 1, memberCount: 2 }])
    api.listMembers.mockResolvedValue([{ ...me, enabled: true, memberRole: 'owner' }, { ...phong, enabled: true, memberRole: 'member' }])
    api.listMemberRequests.mockResolvedValue([request])
    api.updateRoomSettings.mockResolvedValueOnce({ ...eng, myRole: 'owner', requireApproval: true, pendingRequests: 1, memberCount: 2 })
    api.decideMemberRequest.mockResolvedValueOnce([])
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: '· 1 chờ duyệt' }))
    const dialog = screen.getByRole('dialog', { name: 'Thành viên (2)' })
    const toggle = within(dialog).getByRole('switch', { name: /Phê duyệt thành viên mới/ })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(api.updateRoomSettings).toHaveBeenCalledWith(eng.id, { requireApproval: true })
    await waitFor(() => expect(within(dialog).getByRole('switch', { name: /Phê duyệt thành viên mới/ })).toBeChecked())
    const requests = await within(dialog).findByRole('region', { name: 'Yêu cầu chờ duyệt' })
    expect(within(requests).getByText('Do Phong thêm')).toBeInTheDocument()
    await user.click(within(requests).getByRole('button', { name: 'Duyệt' }))
    expect(api.decideMemberRequest).toHaveBeenCalledWith(eng.id, 'rq1', true)
  })

  it('chip ngày giữa khung chat khi sang ngày mới', async () => {
    api.listMessages.mockResolvedValue({
      messages: [
        message('d1', 'tin ngày cũ', { createdAt: '2026-10-31T08:00:00.000Z' }),
        message('d2', 'tin hôm sau', { createdAt: '2026-11-01T08:00:00.000Z' }),
      ],
      nextCursor: null,
    })
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('tin ngày cũ')).toBeInTheDocument()
    const days = screen.getAllByRole('separator').map((s) => s.textContent)
    expect(days).toEqual(['T7 31/10/2026', 'CN 01/11/2026'])
  })

  it('thành viên thường không thấy nút phân quyền', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, myRole: 'member', memberCount: 2 }])
    api.listMembers.mockResolvedValue([{ ...phong, enabled: true, memberRole: 'owner' }, { ...me, enabled: true, memberRole: 'member' }])
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: '2 thành viên' }))
    const dialog = screen.getByRole('dialog', { name: 'Thành viên (2)' })
    expect(await within(dialog).findByText('Trưởng nhóm')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /phó nhóm/ })).not.toBeInTheDocument()
  })

  it('đổi ảnh đại diện tài khoản; ảnh của người khác cập nhật qua user:avatar', async () => {
    api.uploadMyAvatar.mockResolvedValueOnce({ userId: me.id, avatarUrl: '/api/users/u1/avatar?v=1' })
    api.downloadFile.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const user = userEvent.setup()
    api.getMyProfile.mockResolvedValue({ id: me.id, email: me.email, displayName: me.displayName, gender: null, birthDate: null, phone: null, avatarUrl: null, profilePublic: false })
    const { container } = renderChat(`/rooms/${dm.id}`)
    await user.click(await screen.findByRole('button', { name: 'Thông tin tài khoản' }))
    // Không có nút "Chọn ảnh": bấm vào avatar để mở thư viện ảnh.
    expect(screen.queryByRole('button', { name: 'Chọn ảnh' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Đổi ảnh đại diện' })).toBeInTheDocument()
    const file = new File(['png'], 'toi.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('profile-avatar-input'), file)
    expect(api.uploadMyAvatar).toHaveBeenCalledWith(file)
    await waitFor(() => expect(container.querySelector('.chat-user-avatar .avatar-image')).not.toBeNull())

    act(() => emit({ type: 'user:avatar', payload: { userId: phong.id, avatarUrl: '/api/users/u2/avatar?v=2' }, ts: '' }))
    await waitFor(() => expect(container.querySelector('.room-header .avatar-image')).not.toBeNull())
    expect(api.downloadFile).toHaveBeenCalledWith('/api/users/u2/avatar?v=2')
  })
})

describe('tên nhóm, biệt danh, ảnh nhóm', () => {
  const an = { id: 'u3', email: 'an@dqgm.dev', displayName: 'Nguyễn An' }

  it('avatar nhóm mặc định ghép 2–3 thành viên thay cho dấu #', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, previewMembers: [phong, an, me] }, dm])
    const { container } = renderChat(`/rooms/${eng.id}`)
    const nav = screen.getByRole('navigation', { name: 'Danh sách phòng' })
    const link = await within(nav).findByRole('link', { name: /Engineering/ })
    expect(link.querySelectorAll('.group-avatar--n3 .avatar')).toHaveLength(3)
    expect([...link.querySelectorAll('.group-avatar .avatar')].map((a) => a.textContent)).toEqual(['PH', 'NA', 'TĐ'])
    expect(container.querySelector('.room-hash')).toBeNull()
  })

  it('thành viên đổi tên nhóm; báo tên trùng; room:updated cập nhật tên cho người khác', async () => {
    api.renameRoom
      .mockRejectedValueOnce(new ApiError(409, { code: 'invalid_payload', reason: 'room_name_taken' }))
      .mockResolvedValueOnce({ ...eng, name: 'Kỹ thuật' })
    const user = userEvent.setup()
    renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: 'Đổi tên nhóm' }))
    const dialog = screen.getByRole('dialog', { name: 'Đổi tên nhóm' })
    await user.clear(within(dialog).getByLabelText('Tên nhóm'))
    await user.type(within(dialog).getByLabelText('Tên nhóm'), 'HR')
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await within(dialog).findByText('Tên kênh đã tồn tại.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Tên nhóm'))
    await user.type(within(dialog).getByLabelText('Tên nhóm'), 'Kỹ thuật')
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kỹ thuật' })).toBeInTheDocument()
    expect(api.renameRoom).toHaveBeenLastCalledWith(eng.id, 'Kỹ thuật')

    act(() => emit({ type: 'room:updated', payload: { ...eng, name: 'Kỹ thuật 2' }, ts: '' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kỹ thuật 2' })).toBeInTheDocument()
  })

  it('tin nhắn riêng: đặt biệt danh, hiện tên thật bên dưới, xoá biệt danh', async () => {
    api.setNickname.mockResolvedValueOnce({ ...dm, name: 'Anh Phong', nickname: 'Anh Phong' }).mockResolvedValueOnce(dm)
    const user = userEvent.setup()
    renderChat(`/rooms/${dm.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Phong' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Đổi tên nhóm' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Đổi biệt danh' }))
    const dialog = screen.getByRole('dialog', { name: 'Đổi biệt danh' })
    expect(within(dialog).getByText('Biệt danh của Phong chỉ hiện với bạn.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Biệt danh'), '  Anh Phong ')
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }))
    expect(api.setNickname).toHaveBeenLastCalledWith(dm.id, 'Anh Phong')
    expect(await screen.findByRole('heading', { level: 1, name: 'Anh Phong' })).toBeInTheDocument()
    expect(screen.getByText(/Tên thật: Phong/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Đổi biệt danh' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xoá biệt danh' }))
    expect(api.setNickname).toHaveBeenLastCalledWith(dm.id, '')
    expect(await screen.findByRole('heading', { level: 1, name: 'Phong' })).toBeInTheDocument()
  })

  it('đổi ảnh nhóm: chặn file không phải ảnh, tải ảnh lên và hiện ảnh thay avatar ghép', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, previewMembers: [phong, me] }])
    api.uploadRoomAvatar.mockResolvedValueOnce({ ...eng, previewMembers: [phong, me], avatarUrl: '/api/rooms/r-eng/avatar?v=1' })
    api.downloadFile.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
    const user = userEvent.setup({ applyAccept: false })
    const { container } = renderChat(`/rooms/${eng.id}`)
    await user.click(await screen.findByRole('button', { name: 'Đổi ảnh nhóm' }))
    const dialog = screen.getByRole('dialog', { name: 'Ảnh nhóm' })
    await user.upload(within(dialog).getByTestId('group-avatar-input'), new File(['x'], 'a.pdf'))
    expect(within(dialog).getByText('Chỉ dùng được ảnh JPG hoặc PNG.')).toBeInTheDocument()
    expect(api.uploadRoomAvatar).not.toHaveBeenCalled()

    const file = new File(['png'], 'nhom.png', { type: 'image/png' })
    await user.upload(within(dialog).getByTestId('group-avatar-input'), file)
    expect(api.uploadRoomAvatar).toHaveBeenCalledWith(eng.id, file)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(container.querySelector('.room-header .group-avatar-image')).not.toBeNull())
    expect(api.downloadFile).toHaveBeenCalledWith('/api/rooms/r-eng/avatar?v=1')
  })

  it('kênh lưu trữ: không đổi tên / ảnh được', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, archived: true }])
    renderChat(`/rooms/${eng.id}`)
    expect(await screen.findByText('Đã lưu trữ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Đổi tên nhóm' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Đổi ảnh nhóm' })).not.toBeInTheDocument()
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
    await waitFor(() => expect(dmLink).toHaveAccessibleDescription('1 tin chưa đọc'))
    expect(dmLink).toHaveAccessibleName('Phong')
    expect(badge()).toHaveTextContent('1')
    expect(document.title).toBe('(1) Tập Đoàn M Chat')

    for (const i of [2, 3, 4, 5, 6]) act(() => emit({ type: 'message:new', payload: dmMessage(i), ts: '' }))
    await waitFor(() => expect(dmLink).toHaveAccessibleDescription('6 tin chưa đọc'))
    expect(badge()).toHaveTextContent('5+')

    // Tin ở phòng đang xem không bị đếm.
    act(() => emit({ type: 'message:new', payload: message('e1', 'Ở phòng đang mở', { createdAt: '2026-10-21T09:10:00.000Z' }), ts: '' }))
    expect(within(nav).getByRole('link', { name: /Engineering/ }).querySelector('.unread-badge')).toBeNull()

    await user.click(dmLink)
    await waitFor(() => expect(badge()).toBeNull())
    expect(dmLink).not.toHaveAttribute('aria-describedby')
    expect(document.title).toBe('Tập Đoàn M Chat')
  })

  it('số chưa đọc lấy từ server khi tải danh sách phòng (tin đến lúc offline / thiết bị khác)', async () => {
    api.listRooms.mockResolvedValue([{ ...eng, unreadCount: 2 }, hr, { ...dm, unreadCount: 7 }])
    renderChat()
    const nav = screen.getByRole('navigation', { name: 'Danh sách phòng' })
    const engLink = await within(nav).findByRole('link', { name: /Engineering/ })
    expect(engLink.querySelector('.unread-badge')).toHaveTextContent('2')
    expect(within(nav).getByRole('link', { name: /Phong/ }).querySelector('.unread-badge')).toHaveTextContent('5+')
    expect(document.title).toBe('(2) Tập Đoàn M Chat')
  })

  it('tin nhắn riêng không vào chuông và không bật toast; @nhắc tên vẫn vào chuông', async () => {
    renderChat()
    expect(await screen.findByRole('link', { name: /Engineering/ })).toBeInTheDocument()
    await waitFor(() => expect(api.listNotifications).toHaveBeenCalled())
    const dmNote = { id: 'n1', type: 'dm' as const, roomId: dm.id, content: 'Tin riêng', createdAt: '2026-10-21T09:00:00Z', readAt: null }
    act(() => emit({ type: 'notification:new', payload: dmNote, ts: '' }))
    act(() => emit({ type: 'notification:new', payload: { ...dmNote, id: 'n2', type: 'mention', roomId: eng.id, content: '@Thành Đạt xem nhé' }, ts: '' }))
    expect(await screen.findByText('Bạn được nhắc đến')).toBeInTheDocument()
    expect(screen.queryByText('Tin nhắn riêng mới')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Thông báo/ })).toHaveAccessibleName('Thông báo, 1 chưa đọc')
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
