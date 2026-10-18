import { describe, expect, it } from 'vitest'
import { createRegisterSchema, toFieldErrors } from './schemas'

const schema = createRegisterSchema(['pulsechat.dev'])
const valid = {
  email: 'Dat@PulseChat.dev',
  displayName: 'Thành Đạt',
  password: 'secret123',
  confirmPassword: 'secret123',
}

describe('registerSchema', () => {
  it('chuẩn hoá email khi hợp lệ', () => {
    const result = schema.parse(valid)
    expect(result.email).toBe('dat@pulsechat.dev')
  })

  it('báo lỗi domain', () => {
    const result = schema.safeParse({ ...valid, email: 'dat@gmail.com' })
    expect(result.success).toBe(false)
    if (!result.success) expect(toFieldErrors(result.error).email).toMatch('@pulsechat.dev')
  })

  it('báo lỗi mật khẩu yếu và xác nhận không khớp', () => {
    const result = schema.safeParse({ ...valid, password: 'short', confirmPassword: 'other' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = toFieldErrors(result.error)
      expect(errors.password).toBeDefined()
      expect(errors.confirmPassword).toBe('Mật khẩu xác nhận không khớp')
    }
  })

  it('giới hạn mật khẩu 72 byte (bcrypt)', () => {
    const long = 'ạ1'.repeat(30) // 'ạ' = 3 byte UTF-8 → 120 byte
    const result = schema.safeParse({ ...valid, password: long, confirmPassword: long })
    expect(result.success).toBe(false)
  })
})
