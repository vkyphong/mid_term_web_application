import { ApiError } from '../../lib/apiError'

/** Thông báo lỗi tiếng Việt cho các thao tác quản trị. */
export function describeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Tài khoản không có quyền quản trị. Vui lòng đăng nhập lại sau khi được cấp quyền.'
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
    if (error.code === 'network_error') return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
    if (error.details.length) return error.details[0].message
  }
  return 'Chưa thực hiện được thao tác. Vui lòng thử lại.'
}
