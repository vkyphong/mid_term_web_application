# Kiểm thử

Chạy lệnh ở thư mục gốc, trừ khi có ghi khác. Các kiểm thử tạo tài khoản/phòng riêng và giữ dữ liệu đã tạo; không xóa database hiện hữu.

## Unit và integration trong Docker

```powershell
docker build --target frontend-test -t pulsechat-frontend-test -f infra/Dockerfile .
docker build --target backend-test -t pulsechat-backend-test -f infra/Dockerfile .
```

Frontend stage chạy lint và Vitest. Backend stage chạy JUnit, MockMvc, H2 MySQL mode và kết nối WebSocket thật. H2 kiểm tra hành vi độc lập trong build; smoke bên dưới kiểm tra tích hợp với MySQL thật.

## Smoke trên app và MySQL đang chạy

```powershell
docker compose up --build -d --wait
docker compose --profile tools run --build --rm --no-deps smoke
docker compose --profile tools run --build --rm --no-deps --entrypoint node smoke smoke-collaboration.mjs
docker compose --profile tools run --build --rm --no-deps --entrypoint node smoke smoke-lab.mjs
```

| Script | Phạm vi |
| --- | --- |
| `smoke.mjs` (gọi thêm `smoke-chat.mjs`) | SPA, auth, refresh đồng thời, STOMP, kênh, DM, membership và retry |
| `smoke-collaboration.mjs` | Receipts, notifications, typing, reaction, quyền sửa, retry toàn cục, upload và admin denial |
| `smoke-lab.mjs` | Polling, long polling, SSE, raw WebSocket và số liệu so sánh |

`--no-deps` dùng app đã chạy và tránh tạo lại service MySQL khi đang bật Workbench overlay. Đây là test do project viết, chạy khi gọi lệnh.

Các thao tác admin có quyền, như ban và broadcast, được kiểm tra trong backend integration tests. Chi tiết workload và cách ước lượng overhead của Lab ở [API Lab](api/lab.md#reproducible-comparison).

## Browser E2E

Yêu cầu Node trên máy, app thật tại `http://localhost:8080` và domain mặc định `DQGM.dev`:

```powershell
cd client
npm ci
npx playwright install chromium
npm run test:e2e
```

Test F03/F04 dùng ba Chromium context độc lập để kiểm tra membership, DM, lưu lịch sử và reconnect. Workload gửi 5 tin khởi động (không tính) rồi đo 40 tin giữa hai thành viên, chờ ít nhất 550 ms trước mỗi lần gửi để tuân thủ F11. p95 của 40 mẫu là giá trị thứ 38, nên 1–2 gai lẻ trên máy CI dùng chung không quyết định kết quả; log in p50, p95, max và số mẫu ≥ 200 ms. Độ trễ đo từ STOMP SEND tới frame nhận bằng clock của test runner, không tính khoảng chờ; p95 mục tiêu dưới 200 ms trên localhost.

Kết quả workload này không xác nhận tải 500/1000 client hoặc heartbeat blackhole F17/F18. Test chạy headless, tắt screenshot/video/trace và không tạo bộ bằng chứng demo riêng. `history.e2e.ts` kiểm tra UI F05; `realtime.e2e.ts` kiểm tra UI F06–F08 (presence nhiều tab, typing không lộ sang phòng khác, receipts DM). E2E hiện tại chưa nghiệm thu UI F09–F15.

## CI và cách đọc kết quả

[Workflow](../.github/workflows/ci.yml) build/test, khởi động Compose, chạy smoke và browser E2E, rồi dừng container. Việc sửa workflow local không có nghĩa GitHub Actions đã chạy; xem kết quả từng run trên GitHub sau khi push.

Bàn giao backend ngày 24/10/2026 đã chạy 31 backend integration tests, 76 frontend tests, smoke MySQL/Lab và E2E chat thành công. Đây là mốc kiểm tra trước đợt dọn docs; chạy lại các lệnh trên để xác minh phiên bản đang làm việc. Review PR, kiểm thử UI bổ sung và báo cáo/video được theo dõi riêng trong backlog.
