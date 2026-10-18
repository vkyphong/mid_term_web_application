# F01 – Auth REST API contract (draft)

> Trạng thái: **bản nháp do FE đề xuất** – cần TV2 (BE) xác nhận/điều chỉnh trước khi chốt.
> FE (`client/`) và mock API (`client/src/features/auth/mockAuthApi.ts`) đang bám theo tài liệu này.

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

- **Access token** (JWT, 15 phút): trả trong body. FE chỉ giữ trong bộ nhớ, gửi qua header `Authorization: Bearer <token>` (và khi handshake Socket.IO ở F02).
- **Refresh token** (7 ngày): đặt trong cookie, FE không đọc được:

  ```
  Set-Cookie: refreshToken=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=604800
  ```

  - Khi dev qua Vite proxy (`http://localhost:5173` → `:3000`) cookie là same-origin; có thể bỏ `Secure` ở môi trường dev HTTP.
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
| Body sai (zod) | 400 | `invalid_payload` | `validation` (+ `details: [{ field, message }]`) |
| Email ngoài domain | 403 | `forbidden` | `domain_not_allowed` |
| Email đã tồn tại | 409 | `invalid_payload` | `email_taken` |
| Sai email / mật khẩu | 401 | `unauthorized` | `invalid_credentials` |
| Refresh token thiếu / hết hạn / đã thu hồi | 401 | `unauthorized` | `refresh_invalid` |
| Tài khoản bị ban (F12) | 403 | `forbidden` | `banned` |
| Quá giới hạn (F11) | 429 | `rate_limited` | – (`retryAfter`: giây) |

Login sai email hay sai mật khẩu đều trả `invalid_credentials` (không tiết lộ email có tồn tại hay không).
