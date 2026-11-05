import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageItem, type MessageActionsApi } from './components/MessageItem'
import type { ChatMessage } from './types'

vi.mock('./chatApi', () => ({ chatApi: { downloadFile: vi.fn() } }))

const msg = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', roomId: 'r1', clientMsgId: 'c1', sender: { id: 'me', displayName: 'Tôi' }, content: 'Xin chào',
  createdAt: '2026-10-27T08:00:00Z', reactions: [], ...extra,
})

let actions: { [K in keyof Required<MessageActionsApi>]: ReturnType<typeof vi.fn> }
beforeEach(() => {
  actions = {
    edit: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), react: vi.fn().mockResolvedValue(true),
    pin: vi.fn().mockResolvedValue(true), hide: vi.fn().mockResolvedValue(true),
  }
})

function renderItem(message: ChatMessage, own = true) {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(
    <ul>
      <MessageItem
        message={message} own={own} head selfId="me" members={[{ id: 'phong', displayName: 'Phong', email: 'p@dqgm.dev' }]} receipt={null} showReceipt={false}
        trackSeen={false} onRetry={() => {}} actions={actions as unknown as MessageActionsApi}
      />
    </ul>,
    { wrapper },
  )
}

describe('F14 thao tác tin nhắn', () => {
  const openMore = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Thêm' }))

  it('sửa tin (trong menu "Thêm"): Enter lưu, gọi edit với nội dung mới', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Sửa tin nhắn/ }))
    const box = screen.getByRole('textbox', { name: 'Sửa tin nhắn' })
    await user.clear(box)
    await user.type(box, 'Đã sửa{Enter}')
    expect(actions.edit).toHaveBeenCalledWith('m1', 'Đã sửa')
  })

  it('Esc huỷ sửa, không gọi API', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Sửa tin nhắn/ }))
    await user.type(screen.getByRole('textbox', { name: 'Sửa tin nhắn' }), ' thêm{Escape}')
    expect(actions.edit).not.toHaveBeenCalled()
    expect(screen.getByText('Xin chào')).toBeInTheDocument()
  })

  it('thu hồi cần xác nhận', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Thu hồi/ }))
    expect(actions.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Thu hồi' }))
    expect(actions.remove).toHaveBeenCalledWith('m1')
  })

  it('menu "Thêm" có Lưu về máy (khi có file), Ghim, Thu hồi, Xoá chỉ ở phía tôi; Escape đóng menu', async () => {
    const user = userEvent.setup()
    renderItem(msg({ content: '', attachment: { id: 'u1', filename: 'bao-cao.pdf', mediaType: 'application/pdf', size: 10, url: '/api/files/u1' } }))
    await openMore(user)
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())
    expect(items).toEqual(['⤓ Lưu về máy', '📌 Ghim tin nhắn', '↺ Thu hồi', '🗑 Xoá chỉ ở phía tôi'])
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('ghim và xoá chỉ ở phía tôi gọi API tương ứng; tin đã ghim hiện "Bỏ ghim"', async () => {
    const user = userEvent.setup()
    const { unmount } = renderItem(msg())
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Ghim tin nhắn/ }))
    expect(actions.pin).toHaveBeenCalledWith('m1', true)
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Xoá chỉ ở phía tôi/ }))
    expect(actions.hide).toHaveBeenCalledWith('m1')
    unmount()
    renderItem(msg({ pinnedAt: '2026-10-27T08:01:00Z' }))
    await openMore(user)
    await user.click(screen.getByRole('menuitem', { name: /Bỏ ghim tin nhắn/ }))
    expect(actions.pin).toHaveBeenLastCalledWith('m1', false)
  })

  it('nút Trả lời / Chuyển tiếp gọi callback với tin; phần trích tin gốc bấm được để nhảy tới', async () => {
    const user = userEvent.setup()
    const onReply = vi.fn()
    const onForward = vi.fn()
    const onOpen = vi.fn()
    const m = msg({ replyTo: { id: 'm0', sender: { id: 'phong', displayName: 'Phong' }, content: 'Họp lúc 9h nhé', attachmentName: null, deleted: false } })
    render(
      <ul>
        <MessageItem
          message={m} own head selfId="me" members={[]} receipt={null} showReceipt={false} trackSeen={false} onRetry={() => {}}
          actions={actions as unknown as MessageActionsApi} onReply={onReply} onForward={onForward} onOpenMessage={onOpen}
        />
      </ul>,
    )
    await user.click(screen.getByRole('button', { name: 'Trả lời' }))
    expect(onReply).toHaveBeenCalledWith(m)
    await user.click(screen.getByRole('button', { name: 'Chuyển tiếp' }))
    expect(onForward).toHaveBeenCalledWith(m)
    const quote = screen.getByRole('button', { name: 'Tin được trả lời của Phong' })
    expect(quote).toHaveTextContent('Họp lúc 9h nhé')
    await user.click(quote)
    expect(onOpen).toHaveBeenCalledWith('m0')
  })

  it('tin người khác: thả cảm xúc ở góc tin, menu không có sửa / thu hồi', async () => {
    const user = userEvent.setup()
    renderItem(msg({ sender: { id: 'phong', displayName: 'Phong' } }), false)
    expect(screen.getByRole('button', { name: 'Thả cảm xúc' }).closest('.message-stack')).not.toBeNull()
    await openMore(user)
    expect(screen.queryByRole('menuitem', { name: /Sửa tin nhắn/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Thu hồi/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Xoá chỉ ở phía tôi/ })).toBeInTheDocument()
  })

  it('cảm xúc: gom theo emoji; bấm chip của mình gửi active=false (bỏ), không đảo khi gửi lại', async () => {
    const user = userEvent.setup()
    renderItem(msg({ reactions: [{ userId: 'me', emoji: '👍' }, { userId: 'phong', emoji: '👍' }, { userId: 'phong', emoji: '🎉' }] }))
    expect(screen.getByRole('button', { name: '👍 2: Bạn, Phong' })).toHaveAttribute('aria-pressed', 'true')
    // Rê chuột vào chip: hiện tên những người đã thả.
    expect(screen.getByRole('button', { name: '👍 2: Bạn, Phong' }).querySelector('.reaction-who')).toHaveTextContent('Bạn, Phong')
    await user.click(screen.getByRole('button', { name: '👍 2: Bạn, Phong' }))
    expect(actions.react).toHaveBeenCalledWith('m1', '👍', false)
    await user.click(screen.getByRole('button', { name: '🎉 1: Phong' }))
    expect(actions.react).toHaveBeenLastCalledWith('m1', '🎉', true)
  })

  it('tin đã thu hồi: hiện "Tin nhắn đã được thu hồi", không có thao tác, không còn cảm xúc', () => {
    renderItem(msg({ content: '', deletedAt: '2026-10-27T09:00:00Z', reactions: [{ userId: 'me', emoji: '👍' }] }))
    expect(screen.getByText('Tin nhắn đã được thu hồi')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thả cảm xúc' })).not.toBeInTheDocument()
    expect(screen.queryByText(/👍/)).not.toBeInTheDocument()
  })

  it('tin đã sửa hiện "(đã sửa)"', () => {
    renderItem(msg({ editedAt: '2026-10-27T08:05:00Z' }))
    expect(screen.getByText('(đã sửa)', { exact: false })).toBeInTheDocument()
  })
})

describe('F11 hiển thị an toàn và lỗi', () => {
  it('nội dung HTML/script được hiển thị nguyên văn, không tạo phần tử', () => {
    const xss = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    const { container } = renderItem(msg({ content: xss }))
    expect(screen.getByText(xss)).toBeInTheDocument()
    expect(container.querySelector('img, script')).toBeNull()
  })

  it('gửi lỗi hiện lý do và nút thử lại; đang chờ mạng hiện trạng thái chờ', () => {
    const { rerender } = renderItem(msg({ status: 'failed', error: 'Bạn không có quyền trong phòng này.' }))
    expect(screen.getByText(/Gửi lỗi: Bạn không có quyền trong phòng này/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument()
    rerender(
      <ul>
        <MessageItem message={msg({ status: 'queued' })} own head selfId="me" members={[]} receipt={null} showReceipt={false} trackSeen={false} onRetry={() => {}} />
      </ul>,
    )
    expect(screen.getByText('Chờ kết nối để gửi…')).toBeInTheDocument()
  })
})
