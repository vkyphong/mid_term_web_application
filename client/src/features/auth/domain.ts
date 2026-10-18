/** Chuẩn hoá email: bỏ khoảng trắng hai đầu, chữ thường. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Lấy phần domain sau dấu '@' duy nhất. Trả về null nếu email không có đúng một '@'.
 */
export function getEmailDomain(email: string): string | null {
  const parts = normalizeEmail(email).split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return parts[1]
}

/**
 * So khớp CHÍNH XÁC domain (không dùng contains/endsWith) để
 * `a@evilpulsechat.dev` hay `a@pulsechat.dev.evil.com` bị từ chối.
 */
export function isAllowedEmailDomain(email: string, allowedDomains: readonly string[]): boolean {
  const domain = getEmailDomain(email)
  return domain !== null && allowedDomains.includes(domain)
}
