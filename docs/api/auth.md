# F01 — Auth REST API contract

> Implemented by Spring Boot (`server/`) and React (`client/`). Database: MySQL, managed by Flyway. Defaults: `DQGM.dev`, access TTL 900 seconds, fixed refresh lifetime 7 days.

## Tổng quan

| Endpoint | Body | Thành công |
| --- | --- | --- |
| `POST /api/auth/register` | `{ email, displayName, password }` | `201` + `AuthResponse` + set cookie refresh |
| `POST /api/auth/login` | `{ email, password }` | `200` + `AuthResponse` + set cookie refresh |
| `POST /api/auth/refresh` | _(không body, đọc cookie)_ | `200` + `AuthResponse` + **xoay vòng** cookie refresh |
| `POST /api/auth/logout` | _(không body, đọc cookie)_ | `204`, thu hồi refresh token, xoá cookie |

```ts
interface AuthResponse {
  accessToken: string      // JWT, sống 15 phút
  expiresIn: number        // giây, = 900
  user: { id: string; email: string; displayName: string; role: 'user' | 'admin' }
}
```

## Token

- **Access token** (JWT, 15 phút): trả trong body. FE chỉ giữ trong bộ nhớ, gửi qua header `Authorization: Bearer <token>` (gửi trong STOMP CONNECT ở F02; xem [realtime.md](realtime.md)).
- **Refresh token** (7 ngày): đặt trong cookie, FE không đọc được:

  ```
  Set-Cookie: refreshToken=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=604800
  ```

  - Khi dev qua Vite proxy (`http://localhost:5173` → `:8080`) cookie là same-origin; có thể bỏ `Secure` ở môi trường dev HTTP.
  - `/refresh` cấp refresh token mới và vô hiệu token cũ (rotation).
  - `/logout` vô hiệu refresh token hiện tại → dùng lại token cũ phải nhận `401`.
- FE gọi `/refresh` khi tải trang (khôi phục phiên), ~60s trước khi access token hết hạn, và **một lần** khi API trả `401`.

## Kiểm tra domain

- Danh sách domain lấy từ cấu hình (vd `ALLOWED_EMAIL_DOMAINS=pulsechat.dev`).
- Chuẩn hoá: `trim()` + `toLowerCase()`; email phải có **đúng một** `@`.
- So khớp **chính xác** phần sau `@` với danh sách; **không** dùng `includes`/`endsWith`.
  - `a@pulsechat.dev` ✅ · `a@evilpulsechat.dev` ❌ · `a@pulsechat.dev.evil.com` ❌ · `a@sub.pulsechat.dev` ❌
- FE cũng kiểm tra để báo lỗi sớm, nhưng BE là nơi quyết định. Biến FE tương ứng: `VITE_ALLOWED_EMAIL_DOMAINS`.

## Validation

| Field | Quy tắc |
| --- | --- |
| `email` | email hợp lệ, domain được phép |
| `displayName` | 2–50 ký tự sau `trim()` |
| `password` | ≥ 8 ký tự, ≤ 72 byte UTF-8 (giới hạn bcrypt), có chữ và số |

## Lỗi

Mọi lỗi trả về cùng một dạng; `code` theo contract chung của dự án, `reason` để FE hiển thị thông báo cụ thể:

```json
{ "error": { "code": "forbidden", "reason": "domain_not_allowed", "message": "Email domain is not allowed" } }
```

| Tình huống | HTTP | `code` | `reason` |
| --- | --- | --- | --- |
| Body sai (Jakarta/custom validation) | 400 | `invalid_payload` | `validation` (+ `details: [{ field, message }]`) |
| Email ngoài domain | 403 | `forbidden` | `domain_not_allowed` |
| Email đã tồn tại | 409 | `invalid_payload` | `email_taken` |
| Sai email / mật khẩu | 401 | `unauthorized` | `invalid_credentials` |
| Refresh token thiếu / hết hạn / đã thu hồi | 401 | `unauthorized` | `refresh_invalid` |
| Tài khoản bị ban (F12) | 403 | `forbidden` | `banned` |
| Quá giới hạn (F11) | 429 | `rate_limited` | – (`retryAfter`: giây) |

Login sai email hay sai mật khẩu đều trả `invalid_credentials` (không tiết lộ email có tồn tại hay không).

## Persisted sessions and Origin

- `GET /api/auth/me`: Bearer JWT required; returns the `user` object. Invalid/revoked/expired access tokens return 401 with `invalid_token`.
- JWT signature: HS256, issuer `pulsechat`, subject user ID, `sid` auth-session ID. Secret is at least 32 characters, supplied by environment.
- Refresh values are opaque random 256-bit secrets; only SHA-256 hashes are stored in `auth_sessions`. Rotation is single-use with a row lock; stale/replayed refresh values return 401 without invalidating the newly rotated session. Concurrent refresh: exactly one succeeds.
- Logout revokes the persisted session, clears the refresh cookie and closes its WebSockets. Access JWTs for this session also stop working. Independent login sessions remain valid. Retired refresh hashes map old rotated cookies to their session for logout only, so a concurrent refresh cannot undo logout; they cannot be used to refresh.
- Refresh rotation preserves the original seven-day deadline. It does not create an indefinite sliding session. Login/register responses set a new seven-day cookie; refresh cookie Max-Age is the remaining lifetime.
- Exact same-origin requests and configured `ALLOWED_ORIGINS` are accepted. Cross-origin browser requests outside that list return 403. SameSite Strict cookies and Origin checks protect cookie-authenticated POST requests; non-browser clients may omit Origin.
- `enabled=false` in `users` blocks login, refresh, authenticated REST and subsequent STOMP frames. Admin ban management is F12.
- Docker builds frontend with `VITE_USE_MOCK_API=false`; local mock remains optional and is not a real JWT/database implementation.
