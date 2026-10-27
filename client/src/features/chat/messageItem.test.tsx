import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageItem, type MessageActionsApi } from './components/MessageItem'
import type { ChatMessage } from './types'

vi.mock('./chatApi', () => ({ chatApi: { downloadFile: vi.fn() } }))

const msg = (extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', roomId: 'r1', clientMsgId: 'c1', sender: { id: 'me', displayName: 'Tôi' }, content: 'Xin chào',
  createdAt: '2026-10-27T08:00:00Z', reactions: [], ...extra,
})

let actions: { [K in keyof MessageActionsApi]: ReturnType<typeof vi.fn> }
beforeEach(() => {
  actions = { edit: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true), react: vi.fn().mockResolvedValue(true) }
})

function renderItem(message: ChatMessage, own = true) {
  return render(
    <ul>
      <MessageItem
        message={message} own={own} head selfId="me" members={[]} receipt={null} showReceipt={false}
        trackSeen={false} onRetry={() => {}} actions={actions as unknown as MessageActionsApi}
      />
    </ul>,
  )
}

describe('F14 thao tác tin nhắn', () => {
  it('sửa tin: Enter lưu, gọi edit với nội dung mới', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await user.click(screen.getByRole('button', { name: 'Sửa tin nhắn' }))
    const box = screen.getByRole('textbox', { name: 'Sửa tin nhắn' })
    await user.clear(box)
    await user.type(box, 'Đã sửa{Enter}')
    expect(actions.edit).toHaveBeenCalledWith('m1', 'Đã sửa')
  })

  it('Esc huỷ sửa, không gọi API', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await user.click(screen.getByRole('button', { name: 'Sửa tin nhắn' }))
    await user.type(screen.getByRole('textbox', { name: 'Sửa tin nhắn' }), ' thêm{Escape}')
    expect(actions.edit).not.toHaveBeenCalled()
    expect(screen.getByText('Xin chào')).toBeInTheDocument()
  })

  it('xoá cần xác nhận', async () => {
    const user = userEvent.setup()
    renderItem(msg())
    await user.click(screen.getByRole('button', { name: 'Xoá tin nhắn' }))
    expect(actions.remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xoá' }))
    expect(actions.remove).toHaveBeenCalledWith('m1')
  })

  it('tin người khác: chỉ thả cảm xúc, không có sửa/xoá', () => {
    renderItem(msg({ sender: { id: 'phong', displayName: 'Phong' } }), false)
    expect(screen.getByRole('button', { name: 'Thả cảm xúc' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa tin nhắn' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Xoá tin nhắn' })).not.toBeInTheDocument()
  })

  it('cảm xúc: gom theo emoji; bấm chip của mình gửi active=false (bỏ), không đảo khi gửi lại', async () => {
    const user = userEvent.setup()
    renderItem(msg({ reactions: [{ userId: 'me', emoji: '👍' }, { userId: 'phong', emoji: '👍' }, { userId: 'phong', emoji: '🎉' }] }))
    expect(screen.getByRole('button', { name: '👍 2, bạn đã thả' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '👍 2, bạn đã thả' }))
    expect(actions.react).toHaveBeenCalledWith('m1', '👍', false)
    await user.click(screen.getByRole('button', { name: '🎉 1' }))
    expect(actions.react).toHaveBeenLastCalledWith('m1', '🎉', true)
  })

  it('tin đã xoá: hiện "Tin nhắn đã bị xoá", không có thao tác, không còn cảm xúc', () => {
    renderItem(msg({ content: '', deletedAt: '2026-10-27T09:00:00Z', reactions: [{ userId: 'me', emoji: '👍' }] }))
    expect(screen.getByText('Tin nhắn đã bị xoá')).toBeInTheDocument()
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
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
