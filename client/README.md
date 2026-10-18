# PulseChat – Client

React 19 + TypeScript + Vite, TanStack Query, React Router, zod. Test bằng Vitest + Testing Library.

## Chạy

```bash
cd client
npm install
cp .env.example .env.local   # chỉnh nếu cần
npm run dev                  # http://localhost:5173
```

| Biến | Ý nghĩa |
| --- | --- |
| `VITE_USE_MOCK_API` | `true`: dùng mock API trong trình duyệt (khi BE chưa chạy). `false`: gọi BE thật. |
| `VITE_API_PROXY_TARGET` | Địa chỉ BE cho Vite proxy `/api` khi dev (mặc định `http://localhost:3000`). |
| `VITE_API_BASE_URL` | Base URL API khi build/deploy; để trống nếu FE và BE cùng origin. |
| `VITE_ALLOWED_EMAIL_DOMAINS` | Domain email được đăng ký, phân tách bằng dấu phẩy; phải khớp cấu hình BE. |
| `VITE_MOCK_ACCESS_TTL_SECONDS` | TTL access token của mock; đặt `30` để demo tự refresh. |

Mock lưu dữ liệu trong `localStorage` (khoá `pulsechat.mock.*`); xoá các khoá này để reset.

## Lệnh

```bash
npm test         # chạy toàn bộ test một lần
npm run lint
npm run build
```

## Cấu trúc auth (F01)

```
src/
  config.ts                  đọc biến môi trường
  lib/
    apiClient.ts             fetch JSON + cookie; authRequest tự refresh 1 lần khi 401
    apiError.ts              chuẩn hoá lỗi { code, reason, details }
    tokenStore.ts            access token chỉ giữ trong bộ nhớ
  features/auth/
    authApi.ts               REST /api/auth/* (hoặc mockAuthApi khi bật mock)
    domain.ts                so khớp domain email chính xác
    schemas.ts               zod schema cho form
    errors.ts                map lỗi API → thông báo tiếng Việt
    session.ts, hooks.ts     phiên đăng nhập bằng TanStack Query
    AuthProvider.tsx         refresh chủ động, xử lý phiên hết hạn
    components/              LoginPage, RegisterPage, RouteGuards
```

Contract API: [docs/api/auth.md](../docs/api/auth.md).

Dùng `authRequest` (không dùng `fetch` trực tiếp) cho các API cần đăng nhập ở các chức năng sau để được gắn token và tự refresh.
