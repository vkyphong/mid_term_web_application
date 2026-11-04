import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, IMessage } from '@stomp/stompjs'
import { ApiError } from '../../lib/apiError'
import { AdminRoute } from '../auth/components/RouteGuards'
import { sessionQueryKey } from '../auth/session'
import { setActiveClient } from '../realtime/realtimeBus'
import { AdminDashboard } from './AdminDashboard'
import { adminApi } from './adminApi'
import { useAdminStats } from './useAdminStats'

vi.mock('./adminApi', () => ({
  adminApi: {
    stats: vi.fn(), users: vi.fn(), channels: vi.fn(), moderate: vi.fn(), broadcast: vi.fn(),
    groups: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(), archiveGroup: vi.fn(), groupMembers: vi.fn(), addGroupMember: vi.fn(), removeGroupMember: vi.fn(),
    unban: vi.fn(), setRole: vi.fn(), setGroupMemberRole: vi.fn(), setGroupApproval: vi.fn(),
  },
}))
vi.mock('../chat/chatApi', () => ({
  chatApi: {
    listUserAvatars: vi.fn().mockResolvedValue([]),
    getMyProfile: vi.fn().mockResolvedValue({ id: 'admin', email: 'admin@dqgm.dev', displayName: 'IT Admin', avatarUrl: null, gender: null, birthday: null, phone: null, isPublic: true }),
  },
}))
const api = vi.mocked(adminApi)
const stats = { connections: 3, onlineUsers: 2, msgPerSec: 4, activeRooms: 1 }
const admin = { id: 'admin', email: 'admin@dqgm.dev', displayName: 'IT Admin', role: 'admin' }
const project = { id: 'g1', name: 'Dự án A', description: 'Nhóm dự án', archived: false, memberCount: 1, lastMessageAt: null, requireApproval: false, pendingRequests: 0 }
const employee = { id: 'u1', email: 'employee@dqgm.dev', displayName: 'Employee', role: 'user' as const, enabled: true, online: true }

function mount(element = <AdminDashboard />, role = 'admin') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  queryClient.setQueryData(sessionQueryKey, { user: { ...admin, role }, accessToken: 'test', expiresAt: Date.now() + 900_000 })
  return { queryClient, ...render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/admin']}>{element}</MemoryRouter></QueryClientProvider>) }
}

beforeEach(() => {
  vi.resetAllMocks()
  setActiveClient(null)
  api.stats.mockResolvedValue(stats)
  api.users.mockResolvedValue({ users: [{ ...admin, role: 'admin', enabled: true, online: true }, employee], total: 2, page: 0, pageSize: 20 })
  api.channels.mockResolvedValue({ channels: [] })
  api.moderate.mockResolvedValue(undefined)
  api.broadcast.mockResolvedValue({ recipients: 2 })
  api.groups.mockResolvedValue({ groups: [project], total: 1, page: 0, pageSize: 20 })
  api.groupMembers.mockResolvedValue([{ id: 'admin', displayName: 'IT Admin', email: 'admin@dqgm.dev', enabled: true, memberRole: 'owner' }])
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } },
  })
})

describe('admin access and actions', () => {
  it('blocks a regular user from the dashboard', async () => {
    mount(<Routes><Route element={<AdminRoute />}><Route path="/admin" element={<AdminDashboard />} /></Route><Route path="/" element={<p>Chat home</p>} /></Routes>, 'user')
    expect(await screen.findByText('Chat home')).toBeInTheDocument()
    expect(api.stats).not.toHaveBeenCalled()
  })

  it('confirms ban, prevents self-ban and shows server errors without claiming success', async () => {
    const user = userEvent.setup()
    api.moderate.mockRejectedValueOnce(new Error('network'))
    mount()
    const ban = await screen.findByRole('button', { name: `Ban ${employee.email}` })
    expect(screen.getByRole('button', { name: `Ban ${admin.email}` })).toBeDisabled()
    await user.click(ban)
    expect(api.moderate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Hủy' }))
    expect(api.moderate).not.toHaveBeenCalled()
    await user.click(ban)
    await user.click(screen.getByRole('button', { name: 'Xác nhận Ban' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thực hiện được thao tác')
    expect(api.moderate).toHaveBeenCalledWith(employee.id, 'ban')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Xác nhận Ban' }))
    expect(await screen.findByText(`✓ Đã khóa tài khoản ${employee.email}.`)).toBeInTheDocument()
  })

  it('requires confirmation for kick and broadcast, and validates the UTF-8 limit', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: `Kick ${employee.email}` }))
    await user.click(screen.getByRole('button', { name: 'Xác nhận Kick' }))
    await waitFor(() => expect(api.moderate).toHaveBeenCalledWith(employee.id, 'kick'))
    const input = screen.getByLabelText('Nội dung broadcast')
    fireEvent.change(input, { target: { value: 'ế'.repeat(683) } })
    expect(screen.getByRole('button', { name: 'Gửi broadcast' })).toBeDisabled()
    expect(screen.getByText('2049/2048 byte')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Thông báo bảo trì' } })
    await user.click(screen.getByRole('button', { name: 'Gửi broadcast' }))
    expect(api.broadcast).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }))
    await waitFor(() => expect(api.broadcast).toHaveBeenCalledWith('Thông báo bảo trì'))
    expect(await screen.findByText(/Đã gửi thông báo đến 2 tài khoản/)).toBeInTheDocument()
    expect(input).toHaveValue('')
  })
})

it('resubscribes after reconnect, ignores malformed stats, and unsubscribes on unmount', async () => {
  let onFrame!: (frame: IMessage) => void
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((_destination, handler) => { onFrame = handler; return { unsubscribe } })
  const client = { connected: true, subscribe } as unknown as Client
  function Probe() { const q = useAdminStats(); return <p>connections:{q.data?.connections};samples:{q.history.length}</p> }
  const view = mount(<Probe />)
  await screen.findByText('connections:3;samples:0')
  act(() => setActiveClient(client))
  expect(subscribe).toHaveBeenCalledWith('/user/queue/admin', expect.any(Function))
  act(() => onFrame({ body: JSON.stringify({ type: 'admin:stats', payload: { ...stats, connections: -1 } }) } as IMessage))
  expect(screen.getByText('connections:3;samples:0')).toBeInTheDocument()
  act(() => onFrame({ body: JSON.stringify({ type: 'admin:stats', payload: { ...stats, connections: 7 } }) } as IMessage))
  expect(await screen.findByText('connections:7;samples:1')).toBeInTheDocument()
  act(() => setActiveClient(null))
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  act(() => setActiveClient(client))
  expect(subscribe).toHaveBeenCalledTimes(2)
  view.unmount()
  expect(unsubscribe).toHaveBeenCalledTimes(2)
  setActiveClient(null)
})

describe('quản lý nhóm (admin)', () => {
  it('lọc theo trạng thái, tạo nhóm mới, lưu trữ có xác nhận', async () => {
    const user = userEvent.setup()
    api.createGroup.mockResolvedValue({ ...project, id: 'g2', name: 'Dự án B' })
    api.archiveGroup.mockResolvedValue({ ...project, archived: true })
    mount()
    const section = await screen.findByRole('region', { name: /Quản lý nhóm/ })
    expect(await within(section).findByText('Dự án A')).toBeInTheDocument()
    expect(within(section).getByText('Nhóm dự án')).toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Đã lưu trữ' }))
    await waitFor(() => expect(api.groups).toHaveBeenLastCalledWith('', true, 0))

    await user.click(within(section).getByRole('button', { name: '+ Tạo nhóm' }))
    await user.type(screen.getByLabelText('Tên nhóm'), 'Dự án B')
    await user.click(screen.getByRole('button', { name: 'Tạo nhóm' }))
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith({ name: 'Dự án B', description: null }))
    expect(await screen.findByText(/Đã tạo nhóm Dự án B/)).toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Lưu trữ nhóm Dự án A' }))
    expect(api.archiveGroup).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xác nhận lưu trữ' }))
    await waitFor(() => expect(api.archiveGroup).toHaveBeenCalledWith('g1', true))
    expect(await screen.findByText(/Đã lưu trữ nhóm Dự án A/)).toBeInTheDocument()
  })

  it('tên trùng hiện lỗi rõ ràng, không đóng hộp sửa', async () => {
    const user = userEvent.setup()
    api.updateGroup.mockRejectedValue(new ApiError(409, { code: 'invalid_payload', reason: 'room_name_taken', message: 'taken', details: [] }))
    mount()
    const section = await screen.findByRole('region', { name: /Quản lý nhóm/ })
    await user.click(await within(section).findByRole('button', { name: 'Sửa nhóm Dự án A' }))
    const name = screen.getByLabelText('Tên nhóm')
    await user.clear(name)
    await user.type(name, 'HR')
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(await screen.findByText('Tên nhóm đã tồn tại. Hãy chọn tên khác.')).toBeInTheDocument()
    expect(api.updateGroup).toHaveBeenCalledWith('g1', { name: 'HR', description: 'Nhóm dự án' })
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument()
  })

  it('thành viên: thấy trưởng nhóm, tìm và thêm người, xoá cần xác nhận', async () => {
    const user = userEvent.setup()
    api.addGroupMember.mockResolvedValue({ ...project, memberCount: 2 })
    api.removeGroupMember.mockResolvedValue(project)
    mount()
    const section = await screen.findByRole('region', { name: /Quản lý nhóm/ })
    await user.click(await within(section).findByRole('button', { name: 'Thành viên nhóm Dự án A' }))
    const members = await screen.findByRole('list', { name: 'Thành viên nhóm' })
    expect(await within(members).findByText('Trưởng nhóm')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/Tìm tên hoặc email để thêm/), 'emp')
    const results = await screen.findByRole('list', { name: 'Kết quả tìm kiếm' })
    // Người đã trong nhóm (admin) không hiện ở kết quả.
    expect(await within(results).findByText('Employee')).toBeInTheDocument()
    expect(within(results).queryByText('IT Admin')).not.toBeInTheDocument()
    await user.click(within(results).getByRole('button', { name: 'Thêm employee@dqgm.dev' }))
    await waitFor(() => expect(api.addGroupMember).toHaveBeenCalledWith('g1', 'u1'))
    expect(await screen.findByText(/Đã thêm Employee vào nhóm Dự án A/)).toBeInTheDocument()

    await user.click(within(members).getByRole('button', { name: 'Xoá admin@dqgm.dev khỏi nhóm' }))
    expect(api.removeGroupMember).not.toHaveBeenCalled()
    await user.click(within(members).getByRole('button', { name: 'Xác nhận xoá' }))
    await waitFor(() => expect(api.removeGroupMember).toHaveBeenCalledWith('g1', 'admin'))
  })
})

describe('mở khoá tài khoản và quyền admin', () => {
  it('tài khoản bị khoá có nút Mở khóa; cấp / thu quyền admin cần xác nhận; không đổi quyền chính mình', async () => {
    const user = userEvent.setup()
    const banned = { ...employee, id: 'u2', email: 'banned@dqgm.dev', displayName: 'Banned', enabled: false, online: false }
    const otherAdmin = { ...employee, id: 'u3', email: 'boss@dqgm.dev', displayName: 'Boss', role: 'admin' as const }
    api.users.mockResolvedValue({ users: [{ ...admin, role: 'admin', enabled: true, online: true }, employee, banned, otherAdmin], total: 4, page: 0, pageSize: 20 })
    api.unban.mockResolvedValue(undefined)
    api.setRole.mockResolvedValue(undefined)
    mount()
    expect(await screen.findByRole('button', { name: 'Mở khóa banned@dqgm.dev' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Ban banned@dqgm.dev' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thu quyền admin admin@dqgm.dev' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Mở khóa banned@dqgm.dev' }))
    expect(api.unban).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xác nhận mở khóa' }))
    await waitFor(() => expect(api.unban).toHaveBeenCalledWith('u2'))
    expect(await screen.findByText(/Đã mở khóa tài khoản banned@dqgm.dev/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cấp quyền admin employee@dqgm.dev' }))
    await user.click(screen.getByRole('button', { name: 'Xác nhận cấp quyền' }))
    await waitFor(() => expect(api.setRole).toHaveBeenCalledWith('u1', 'admin'))

    await user.click(screen.getByRole('button', { name: 'Thu quyền admin boss@dqgm.dev' }))
    await user.click(screen.getByRole('button', { name: 'Xác nhận thu hồi' }))
    await waitFor(() => expect(api.setRole).toHaveBeenLastCalledWith('u3', 'user'))
    expect(await screen.findByText(/Đã thu hồi quyền admin của boss@dqgm.dev/)).toBeInTheDocument()
  })
})

describe('trưởng / phó nhóm và phê duyệt (admin)', () => {
  it('chọn phó nhóm đổi ngay; chọn trưởng nhóm mới cần xác nhận; bật phê duyệt', async () => {
    const user = userEvent.setup()
    const list = [
      { id: 'admin', displayName: 'IT Admin', email: 'admin@dqgm.dev', enabled: true, memberRole: 'owner' as const },
      { id: 'u1', displayName: 'Employee', email: 'employee@dqgm.dev', enabled: true, memberRole: 'member' as const },
    ]
    api.groupMembers.mockResolvedValue(list)
    api.setGroupMemberRole.mockImplementation(async (_g, id, role) => list.map((m) => (m.id === id ? { ...m, memberRole: role } : m)))
    api.setGroupApproval.mockResolvedValue({ ...project, requireApproval: true })
    mount()
    const section = await screen.findByRole('region', { name: /Quản lý nhóm/ })
    await user.click(await within(section).findByRole('button', { name: 'Thành viên nhóm Dự án A' }))
    // Trưởng nhóm hiện tại không đổi trực tiếp được.
    expect(await screen.findByRole('combobox', { name: 'Vai trò của IT Admin' })).toBeDisabled()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Employee' }), 'deputy')
    await waitFor(() => expect(api.setGroupMemberRole).toHaveBeenCalledWith('g1', 'u1', 'deputy'))
    expect(await screen.findByText(/Employee giờ là phó nhóm của Dự án A/)).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Employee' }), 'owner')
    expect(api.setGroupMemberRole).toHaveBeenCalledTimes(1)
    const confirm = screen.getByRole('alertdialog', { name: 'Xác nhận chuyển trưởng nhóm' })
    await user.click(within(confirm).getByRole('button', { name: 'Xác nhận chuyển' }))
    await waitFor(() => expect(api.setGroupMemberRole).toHaveBeenLastCalledWith('g1', 'u1', 'owner'))
    expect(await screen.findByText(/Employee là trưởng nhóm mới của Dự án A/)).toBeInTheDocument()

    const approval = screen.getByRole('switch', { name: /Phê duyệt thành viên mới/ })
    expect(approval).not.toBeChecked()
    await user.click(approval)
    await waitFor(() => expect(api.setGroupApproval).toHaveBeenCalledWith('g1', true))
    expect(approval).toBeChecked()
  })
})

describe('menu trái và avatar', () => {
  it('bấm mục nào thì mục đó sáng; avatar mở Thông tin tài khoản như bên chat', async () => {
    const user = userEvent.setup()
    mount()
    const nav = screen.getByRole('navigation', { name: 'Quản trị' })
    expect(within(nav).getByRole('link', { name: 'Live Dashboard' })).toHaveAttribute('aria-current', 'location')
    await user.click(within(nav).getByRole('link', { name: 'Nhóm' }))
    expect(within(nav).getByRole('link', { name: 'Nhóm' })).toHaveClass('admin-nav-active')
    expect(within(nav).getByRole('link', { name: 'Nhóm' })).toHaveAttribute('aria-current', 'location')
    expect(within(nav).getByRole('link', { name: 'Live Dashboard' })).not.toHaveClass('admin-nav-active')
    await user.click(within(nav).getByRole('link', { name: 'Broadcast' }))
    expect(within(nav).getByRole('link', { name: 'Broadcast' })).toHaveClass('admin-nav-active')

    // Avatar dùng chung với chat: 2 chữ cái đầu, bấm mở hộp thông tin tài khoản.
    const avatar = screen.getByRole('button', { name: 'Thông tin tài khoản' })
    expect(avatar).toHaveTextContent('IA')
    await user.click(avatar)
    expect(await screen.findByRole('dialog', { name: /Thông tin tài khoản/ })).toBeInTheDocument()
  })
})
