import { ApiError } from '../../lib/apiError'
import { config } from '../../config'
import type { FieldErrors } from './schemas'

export interface AuthErrorView {
  /** Thông báo chung hiển thị trên form. */
  message: string
  /** Lỗi gắn với từng field (nếu có). */
  fields: FieldErrors
}

const domainList = () => config.allowedEmailDomains.map((d) => `@${d}`).join(', ')

/** Chuyển lỗi từ API thành thông báo tiếng Việt cho form auth. */
export function describeAuthError(err: unknown): AuthErrorView {
  if (!(err instanceof ApiError)) {
    return { message: 'Đã có lỗi xảy ra, vui lòng thử lại.', fields: {} }
  }

  const fields: FieldErrors = {}
  for (const d of err.details) fields[d.field] ??= d.message

  switch (err.reason) {
    case 'domain_not_allowed':
      return {
        message: 'Email không thuộc domain công ty.',
        fields: { email: domainList() ? `Chỉ chấp nhận email ${domainList()}` : 'Domain không được phép' },
      }
    case 'email_taken':
      return { message: 'Email này đã được đăng ký.', fields: { email: 'Email đã tồn tại' } }
    case 'invalid_credentials':
      return { message: 'Email hoặc mật khẩu không đúng.', fields: {} }
    case 'banned':
      return { message: 'Tài khoản đã bị khoá. Liên hệ quản trị viên.', fields: {} }
  }

  switch (err.code) {
    case 'network_error':
      return { message: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', fields }
    case 'rate_limited':
      return {
        message: err.retryAfter
          ? `Bạn thao tác quá nhanh. Thử lại sau ${err.retryAfter} giây.`
          : 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
        fields,
      }
    case 'invalid_payload':
      return { message: 'Dữ liệu không hợp lệ.', fields }
    case 'unauthorized':
      return { message: 'Phiên đăng nhập không hợp lệ.', fields }
    case 'forbidden':
      return { message: 'Bạn không có quyền thực hiện thao tác này.', fields }
    default:
      return { message: 'Máy chủ gặp lỗi, vui lòng thử lại.', fields }
  }
}
