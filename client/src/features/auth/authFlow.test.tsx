import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { config } from '../../config'
import { refreshAccessToken } from '../../lib/apiClient'
import { ApiError } from '../../lib/apiError'
import { tokenStore } from '../../lib/tokenStore'
import { authApi } from './authApi'
import { AuthProvider } from './AuthProvider'
import type { AuthResponse } from './types'

vi.mock('./authApi', () => ({
  authApi: { register: vi.fn(), login: vi.fn(), refresh: vi.fn(), logout: vi.fn() },
}))
vi.mock('../realtime/RealtimeStatus', () => ({ RealtimeStatus: () => null }))
vi.mock('../chat/chatApi', () => ({
  chatApi: { listRooms: vi.fn().mockResolvedValue([]) },
  chatTransport: { onEvent: () => () => {}, onConnected: () => () => {} },
}))

const api = vi.mocked(authApi)
const domain = config.allowedEmailDomains[0]
const companyEmail = `dat@${domain}`

const authResponse: AuthResponse = {
  accessToken: 'access-1',
  expiresIn: 900,
  user: { id: 'u1', email: companyEmail, displayName: 'Thành Đạt', role: 'user' },
}

const noSession = () => new ApiError(401, { code: 'unauthorized', reason: 'refresh_invalid' })

function renderApp(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  tokenStore.set(null)
  api.refresh.mockRejectedValue(noSession())
  api.logout.mockResolvedValue(undefined)
})

describe('trạng thái phiên', () => {
  it('chưa đăng nhập thì chuyển về /login', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
  })

  it('khôi phục phiên bằng refresh cookie khi tải trang', async () => {
    api.refresh.mockResolvedValueOnce(authResponse)
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Xin chào, Thành Đạt/ })).toBeInTheDocument()
    expect(tokenStore.get()).toBe('access-1')
  })

  it('refresh thất bại thì kết thúc phiên và báo hết hạn', async () => {
    api.refresh.mockResolvedValueOnce(authResponse)
    renderApp('/')
    await screen.findByRole('heading', { name: /Xin chào/ })

    api.refresh.mockRejectedValueOnce(noSession())
    await act(async () => { await refreshAccessToken() })

    expect(await screen.findByText(/Phiên đăng nhập đã hết hạn/)).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
  })

  it('lỗi mạng khi refresh không xoá phiên', async () => {
    api.refresh.mockResolvedValueOnce(authResponse)
    renderApp('/')
    await screen.findByRole('heading', { name: /Xin chào/ })
    api.refresh.mockRejectedValueOnce(new ApiError(0, { code: 'network_error' }))
    await act(async () => { await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'network_error' }) })
    expect(tokenStore.get()).toBe('access-1')
    expect(screen.getByRole('heading', { name: /Xin chào/ })).toBeInTheDocument()
  })

  it('refresh đang chạy không khôi phục phiên sau logout', async () => {
    api.refresh.mockResolvedValueOnce(authResponse)
    renderApp('/')
    await screen.findByRole('heading', { name: /Xin chào/ })
    let resolve!: (value: AuthResponse) => void
    api.refresh.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const pending = refreshAccessToken()
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    await screen.findByRole('heading', { name: 'Đăng nhập' })
    await act(async () => { resolve(authResponse); await pending })
    expect(tokenStore.get()).toBeNull()
    expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
  })
})

describe('đăng ký', () => {
  it('chặn email ngoài domain ngay ở client, không gọi API', async () => {
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Email công ty'), 'dat@gmail.com')
    await user.type(screen.getByLabelText('Tên hiển thị'), 'Đạt')
    await user.type(screen.getByLabelText('Mật khẩu'), 'secret123')
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    expect(screen.getByLabelText('Email công ty')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(`Chỉ chấp nhận email @${domain}`)).toBeInTheDocument()
    expect(api.register).not.toHaveBeenCalled()
  })

  it('hiển thị lỗi domain từ server (BE là nguồn quyết định)', async () => {
    api.register.mockRejectedValueOnce(
      new ApiError(403, { code: 'forbidden', reason: 'domain_not_allowed' }),
    )
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Email công ty'), companyEmail)
    await user.type(screen.getByLabelText('Tên hiển thị'), 'Đạt')
    await user.type(screen.getByLabelText('Mật khẩu'), 'secret123')
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email không thuộc domain công ty.')
  })

  it('hiển thị lỗi email đã tồn tại', async () => {
    api.register.mockRejectedValueOnce(
      new ApiError(409, { code: 'invalid_payload', reason: 'email_taken' }),
    )
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Email công ty'), companyEmail)
    await user.type(screen.getByLabelText('Tên hiển thị'), 'Đạt')
    await user.type(screen.getByLabelText('Mật khẩu'), 'secret123')
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    expect(await screen.findByText('Email đã tồn tại')).toBeInTheDocument()
  })

  it('đăng ký thành công thì vào app, gửi email đã chuẩn hoá', async () => {
    api.register.mockResolvedValueOnce(authResponse)
    const user = userEvent.setup()
    renderApp('/register')
    await user.type(await screen.findByLabelText('Email công ty'), ` DAT@${domain.toUpperCase()} `)
    await user.type(screen.getByLabelText('Tên hiển thị'), 'Thành Đạt')
    await user.type(screen.getByLabelText('Mật khẩu'), 'secret123')
    await user.type(screen.getByLabelText('Xác nhận mật khẩu'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))

    expect(await screen.findByRole('heading', { name: /Xin chào/ })).toBeInTheDocument()
    expect(api.register).toHaveBeenCalledWith({
      email: companyEmail,
      displayName: 'Thành Đạt',
      password: 'secret123',
    })
  })
})

describe('đăng nhập / đăng xuất', () => {
  it('sai mật khẩu hiển thị lỗi', async () => {
    api.login.mockRejectedValueOnce(
      new ApiError(401, { code: 'unauthorized', reason: 'invalid_credentials' }),
    )
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Email'), companyEmail)
    await user.type(screen.getByLabelText('Mật khẩu'), 'wrongpass1')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.')
  })

  it('báo lỗi khi bỏ trống', async () => {
    const user = userEvent.setup()
    renderApp('/login')
    await user.click(await screen.findByRole('button', { name: 'Đăng nhập' }))
    expect(screen.getByText('Vui lòng nhập email')).toBeInTheDocument()
    expect(screen.getByText('Vui lòng nhập mật khẩu')).toBeInTheDocument()
    expect(api.login).not.toHaveBeenCalled()
  })

  it('đăng nhập rồi đăng xuất, xoá token khỏi bộ nhớ', async () => {
    api.login.mockResolvedValueOnce(authResponse)
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(await screen.findByLabelText('Email'), companyEmail)
    await user.type(screen.getByLabelText('Mật khẩu'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Đăng nhập' }))

    await screen.findByRole('heading', { name: /Xin chào/ })
    expect(tokenStore.get()).toBe('access-1')

    await user.click(screen.getByRole('button', { name: 'Đăng xuất' }))
    expect(await screen.findByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument()
    expect(api.logout).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(tokenStore.get()).toBeNull())
    expect(screen.queryByText(/hết hạn/)).not.toBeInTheDocument()
  })
})
