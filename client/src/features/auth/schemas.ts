import { z } from 'zod'
import { config } from '../../config'
import { isAllowedEmailDomain, normalizeEmail } from './domain'

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length

const email = z
  .string()
  .trim()
  .min(1, 'Vui lòng nhập email')
  .email('Email không hợp lệ')
  .transform(normalizeEmail)

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})

export function createRegisterSchema(allowedDomains: readonly string[]) {
  return z
    .object({
      email: email.refine(
        (value) => allowedDomains.length === 0 || isAllowedEmailDomain(value, allowedDomains),
        { message: `Chỉ chấp nhận email @${allowedDomains.join(', @')}` },
      ),
      displayName: z
        .string()
        .trim()
        .min(2, 'Tên hiển thị tối thiểu 2 ký tự')
        .max(50, 'Tên hiển thị tối đa 50 ký tự'),
      password: z
        .string()
        .min(8, 'Mật khẩu tối thiểu 8 ký tự')
        // bcrypt chỉ dùng 72 byte đầu.
        .refine((v) => utf8Bytes(v) <= 72, 'Mật khẩu tối đa 72 byte')
        .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Mật khẩu cần có cả chữ và số'),
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
      path: ['confirmPassword'],
      message: 'Mật khẩu xác nhận không khớp',
    })
}

export const registerSchema = createRegisterSchema(config.allowedEmailDomains)

export type FieldErrors = Partial<Record<string, string>>

/** Lấy lỗi đầu tiên của mỗi field từ ZodError. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    out[key] ??= issue.message
  }
  return out
}

/** Bỏ lỗi của một field (xoá hẳn key để không che lỗi từ server). */
export function clearFieldError(errors: FieldErrors, field: string): FieldErrors {
  if (!(field in errors)) return errors
  const { [field]: _removed, ...rest } = errors
  void _removed
  return rest
}
