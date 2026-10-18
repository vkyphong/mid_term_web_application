import { describe, expect, it } from 'vitest'
import { getEmailDomain, isAllowedEmailDomain } from './domain'

const allowed = ['pulsechat.dev']

describe('isAllowedEmailDomain', () => {
  it.each(['dat@pulsechat.dev', '  Dat@PulseChat.DEV  '])('chấp nhận %s', (email) => {
    expect(isAllowedEmailDomain(email, allowed)).toBe(true)
  })

  it.each([
    'dat@evilpulsechat.dev', // endsWith('pulsechat.dev') sẽ lọt
    'dat@pulsechat.dev.evil.com', // contains('pulsechat.dev') sẽ lọt
    'dat@sub.pulsechat.dev',
    'dat@gmail.com',
    'pulsechat.dev',
    'a@b@pulsechat.dev',
    '@pulsechat.dev',
    'dat@',
  ])('từ chối %s', (email) => {
    expect(isAllowedEmailDomain(email, allowed)).toBe(false)
  })

  it('hỗ trợ nhiều domain', () => {
    expect(isAllowedEmailDomain('a@corp.vn', ['pulsechat.dev', 'corp.vn'])).toBe(true)
  })
})

describe('getEmailDomain', () => {
  it('trả về domain đã chuẩn hoá', () => {
    expect(getEmailDomain(' A@Corp.VN ')).toBe('corp.vn')
  })
})
