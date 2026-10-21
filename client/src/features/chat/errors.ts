import { ApiError } from '../../lib/apiError'

/** Thông báo tiếng Việt cho lỗi REST / ack của chat. */
export function describeChatError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Đã có lỗi xảy ra, vui lòng thử lại.'
  if (err.reason === 'room_name_taken') return 'Tên kênh đã tồn tại.'
  if (err.reason === 'not_found') return 'Không tìm thấy phòng.'
  if (err.details.length) return err.details[0].message
  switch (err.code) {
    case 'network_error':
      return 'Mất kết nối tới máy chủ, chưa thực hiện được.'
    case 'forbidden':
      return 'Bạn không có quyền trong phòng này.'
    case 'rate_limited':
      return 'Bạn thao tác quá nhanh, thử lại sau.'
    case 'invalid_payload':
      return 'Dữ liệu không hợp lệ.'
    case 'unauthorized':
      return 'Phiên đăng nhập không hợp lệ.'
    default:
      return 'Máy chủ gặp lỗi, vui lòng thử lại.'
  }
}
