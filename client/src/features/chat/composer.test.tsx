import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { chatApi } from './chatApi'
import { Composer } from './components/Composer'

vi.mock('./chatApi', () => ({ chatApi: { uploadFile: vi.fn() } }))

const me = { id: 'u1', displayName: 'Thành Đạt', email: 'dat@dqgm.dev', enabled: true }
const phong = { id: 'u2', displayName: 'Vòng Phong', email: 'phong@dqgm.dev', enabled: true }
const an = { id: 'u3', displayName: 'Nguyễn An', email: 'an@dqgm.dev', enabled: true }
const locked = { id: 'u4', displayName: 'Phạm Khoá', email: 'k@dqgm.dev', enabled: false }

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn()
  render(
    <Composer roomId="r1" placeholder="Nhập @, tin nhắn tới #Dự án" onSend={onSend} members={[me, phong, an, locked]} selfId="u1" allowMentionAll {...props} />,
  )
  return { onSend, user: userEvent.setup(), box: screen.getByLabelText('Nội dung tin nhắn') }
}

describe('thanh công cụ soạn tin (kiểu Zalo)', () => {
  it('có đủ các nút công cụ; "Thêm thành viên" chỉ khi được truyền vào', () => {
    const onAddMembers = vi.fn()
    setup({ onAddMembers })
    for (const name of ['Biểu tượng cảm xúc', 'Gửi hình ảnh', 'Đính kèm tệp', 'Nhắc tên thành viên', 'Thêm thành viên']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('chèn emoji vào vị trí con trỏ', async () => {
    const { user, box } = setup()
    await user.type(box, 'Chào  bạn')
    ;(box as HTMLTextAreaElement).setSelectionRange(5, 5)
    await user.click(screen.getByRole('button', { name: 'Biểu tượng cảm xúc' }))
    await user.click(screen.getByRole('button', { name: 'Chèn 🎉' }))
    expect(box).toHaveValue('Chào 🎉 bạn')
  })

  it('nút @ mở danh sách: @All đứng đầu, không có người bị khoá; chọn @All gửi ID cả nhóm', async () => {
    const { user, box, onSend } = setup()
    await user.type(box, 'Họp lúc 9h')
    await user.click(screen.getByRole('button', { name: 'Nhắc tên thành viên' }))
    expect(box).toHaveValue('Họp lúc 9h @')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['@@All Báo cho cả nhóm (2 người)', 'VPVòng Phong', 'NANguyễn An'])
    await user.click(screen.getByRole('button', { name: /@All/ }))
    expect(box).toHaveValue('Họp lúc 9h @All ')
    await user.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('Họp lúc 9h @All', { mentions: ['u2', 'u3'], upload: undefined })
  })

  it('ô trống thì nút gửi là 👍 và gửi nhanh; có chữ thì thành nút Gửi', async () => {
    const { user, box, onSend } = setup()
    await user.click(screen.getByRole('button', { name: 'Gửi nhanh 👍' }))
    expect(onSend).toHaveBeenCalledWith('👍', {})
    await user.type(box, 'ok')
    expect(screen.queryByRole('button', { name: 'Gửi nhanh 👍' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeEnabled()
  })

  it('tin nhắn riêng không có @All', async () => {
    const { user } = setup({ allowMentionAll: false, members: [me, phong] })
    await user.click(screen.getByRole('button', { name: 'Nhắc tên thành viên' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['VPVòng Phong'])
  })

  it('nút gửi ảnh báo lỗi khi chọn file không phải ảnh', async () => {
    setup()
    // Người dùng có thể chọn "All files" trong hộp chọn file, bỏ qua thuộc tính accept.
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByTestId('image-input'), new File(['x'], 'bao-cao.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('Chỉ gửi được ảnh JPG hoặc PNG.')).toBeInTheDocument()
  })

  it('Ctrl+V dán ảnh: hiện khay "N ảnh", tải lên ngay; gửi thì mỗi ảnh một tin rồi tới lời nhắn', async () => {
    const upload = vi.mocked(chatApi.uploadFile)
    upload.mockImplementation(async (_room, file) => ({
      id: `up-${file.name}`, roomId: 'r1', filename: file.name, mediaType: file.type, size: file.size, url: `/api/uploads/up-${file.name}`,
    }))
    const { user, box, onSend } = setup()
    const shot = new File(['png'], 'image.png', { type: 'image/png' })
    const photo = new File(['jpg'], 'the-sinh-vien.jpg', { type: 'image/jpeg' })
    fireEvent.paste(box, { clipboardData: { files: [shot, photo] } })

    const trayBox = await screen.findByRole('group', { name: 'Ảnh sẽ gửi' })
    expect(within(trayBox).getByText('2 ảnh')).toBeInTheDocument()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    // Ảnh dán không tên được đặt tên "anh-dan-…png".
    expect(upload.mock.calls[0][1].name).toMatch(/^anh-dan-\d+\.png$/)
    expect(upload.mock.calls[1][1].name).toBe('the-sinh-vien.jpg')
    expect(box).toHaveValue('') // không dán chữ vào ô nhập

    await user.type(box, 'Thẻ sinh viên nè')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(onSend.mock.calls.map(([text, opts]) => [text, opts.upload?.filename])).toEqual([
      ['', upload.mock.calls[0][1].name],
      ['', 'the-sinh-vien.jpg'],
      ['Thẻ sinh viên nè', undefined],
    ])
    expect(screen.queryByRole('group', { name: 'Ảnh sẽ gửi' })).not.toBeInTheDocument()
  })

  it('khay ảnh: bỏ từng ảnh, Xoá tất cả; nút + mở chọn ảnh', async () => {
    vi.mocked(chatApi.uploadFile).mockImplementation(() => new Promise(() => {}))
    const { user, box } = setup()
    fireEvent.paste(box, { clipboardData: { files: [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })] } })
    const trayBox = await screen.findByRole('group', { name: 'Ảnh sẽ gửi' })
    await user.click(within(trayBox).getByRole('button', { name: 'Bỏ ảnh 1' }))
    expect(within(trayBox).getByText('1 ảnh')).toBeInTheDocument()
    expect(within(trayBox).getByRole('button', { name: 'Thêm ảnh' })).toBeInTheDocument()
    await user.click(within(trayBox).getByRole('button', { name: 'Xoá tất cả' }))
    expect(screen.queryByRole('group', { name: 'Ảnh sẽ gửi' })).not.toBeInTheDocument()
  })
})

describe('trả lời tin (kiểu Zalo)', () => {
  const original = {
    id: 'm9', roomId: 'r1', clientMsgId: 'c9', sender: { id: 'u2', displayName: 'Vòng Phong' }, content: 'Mai họp lúc mấy giờ?',
    createdAt: '2026-11-05T08:00:00Z', reactions: [],
  }

  it('hiện khung "Trả lời <tên>", tin gửi đi mang replyTo rồi khung tự đóng', async () => {
    const onCancelReply = vi.fn()
    const { user, box, onSend } = setup({ replyTo: original, onCancelReply })
    const bar = screen.getByRole('status', { name: 'Đang trả lời' })
    expect(bar).toHaveTextContent('Trả lời Vòng Phong')
    expect(bar).toHaveTextContent('Mai họp lúc mấy giờ?')
    await user.type(box, '9h nhé{Enter}')
    expect(onSend).toHaveBeenCalledWith('9h nhé', expect.objectContaining({ replyTo: original }))
    expect(onCancelReply).toHaveBeenCalled()
  })

  it('nút × và phím Escape huỷ trả lời', async () => {
    const onCancelReply = vi.fn()
    const { user, box } = setup({ replyTo: original, onCancelReply })
    await user.click(screen.getByRole('button', { name: 'Huỷ trả lời' }))
    expect(onCancelReply).toHaveBeenCalledTimes(1)
    await user.click(box)
    await user.keyboard('{Escape}')
    expect(onCancelReply).toHaveBeenCalledTimes(2)
  })
})
