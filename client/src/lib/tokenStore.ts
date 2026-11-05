/** Access token chỉ giữ trong bộ nhớ; refresh token nằm trong cookie httpOnly. */
let accessToken: string | null = null

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token
  },
}
