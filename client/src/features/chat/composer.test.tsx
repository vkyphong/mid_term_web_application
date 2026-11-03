import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
})
