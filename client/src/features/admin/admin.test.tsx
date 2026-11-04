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
  },
}))
const api = vi.mocked(adminApi)
const stats = { connections: 3, onlineUsers: 2, msgPerSec: 4, activeRooms: 1 }
const admin = { id: 'admin', email: 'admin@dqgm.dev', displayName: 'IT Admin', role: 'admin' }
const project = { id: 'g1', name: 'Dự án A', description: 'Nhóm dự án', archived: false, memberCount: 1, lastMessageAt: null }
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
