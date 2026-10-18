/**
 * Access token chỉ nằm trong bộ nhớ (không localStorage) để giảm rủi ro XSS.
 * Refresh token do BE đặt trong cookie httpOnly, JS không đọc được.
 */
let accessToken: string | null = null

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token
  },
}
