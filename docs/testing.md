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

Kết quả workload này không xác nhận tải 500/1000 client hoặc heartbeat blackhole F17/F18. Test chạy headless, tắt screenshot/video/trace và không tạo bộ bằng chứng demo riêng. `history.e2e.ts` kiểm tra UI F05; `realtime.e2e.ts` kiểm tra UI F06–F08 (presence nhiều tab, typing không lộ sang phòng khác, receipts DM). `collaboration.e2e.ts` kiểm tra UI F09 (mention, toast, badge, đồng bộ đã đọc), F10 (offline rồi gửi bù đúng thứ tự), F11 (vượt giới hạn tự chờ, XSS), F14 (sửa/xoá/cảm xúc) và F15 (ảnh, PDF, file quá 5 MB, người ngoài bị 403). E2E chưa nghiệm thu UI F12–F13.

## Bảng trắng cộng tác (F19)

Chạy unit test trong `client/`:

```powershell
npm.cmd test -- src/features/whiteboard
```

Các test kiểm tra tọa độ chuẩn hóa, path Canvas độc lập, merge snapshot/event, duplicate ack/broadcast, khoảng trống revision, hàng đợi tối đa 32 gói, nhịp gửi 200 ms, retry giữ nguyên ID, clear generation và mất quyền truy cập. `WhiteboardIntegrationTest` dùng STOMP thật/H2 để kiểm tra hai tác giả đồng thời, snapshot riêng tư, dedupe, validation/packet/storage cap, clear retry/stale generation, rời/tham gia lại và hạn mức vẽ không dùng quota chat.

E2E trên app/MySQL thật:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
try {
    npm.cmd --prefix client run test:e2e -- whiteboard.e2e.ts
} finally {
    Remove-Item Env:PLAYWRIGHT_CHANNEL
}
```

Test tạo ba tài khoản thường và các phòng riêng; kiểm tra vẽ đồng thời, ảnh Canvas cùng revision với sai số raster nhỏ, người ngoài không đọc/gửi/nhận nét, chat trong lúc vẽ, reload/reconnect, rời/tham gia lại, touch/mobile 390px, hủy/xác nhận clear rồi vẽ ở generation mới. Đặt `WHITEBOARD_EVIDENCE_DIR` khi chủ động cần lưu ảnh/JSON. Xem [bằng chứng F19](evidence/f19/README.md) và [thiết kế tiếng Anh](features/whiteboard.md). Không xóa database hoặc board hiện hữu để chạy test.

Xác minh local 28/10/2026: lint/production build, **166 frontend tests**, **39 backend integration tests** và browser E2E F19 đều pass. Chưa suy ra peer review hoặc nghiệm thu báo cáo/video từ các kiểm tra này.

## Protocol Lab (F13)

Chạy unit test trong `client/`:

```powershell
npm.cmd test -- src/features/lab
```

Các test kiểm tra cấu hình, byte UTF-8, percentile nearest-rank, header/frame overhead, SSE bị chia nhỏ qua nhiều chunk, lịch gửi giống nhau cho đủ bốn giao thức, chỉ đo pong từ đúng đường nhận, phát hiện payload sai và hủy long poll đang chờ. Backend integration kiểm tra echo/validation `correlationId` và lịch sử theo auth session. Auth flow có test quay lại `/lab` sau login.

Browser E2E cần app thật đang healthy tại cổng 8080:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
try {
    npm.cmd --prefix client run test:e2e -- lab.e2e.ts
} finally {
    Remove-Item Env:PLAYWRIGHT_CHANNEL
}
```

Test tự tạo tài khoản thường, chạy preset đầy đủ 20 tin/giao thức, đối chiếu cấu hình/số mẫu/thời lượng/p50/p95/counters, xác nhận frame WebSocket là JSON không STOMP, thử auth session khác của cùng tài khoản, JSON export, hủy và mobile 390px. Giữ tab ở phía trước khi chạy thủ công. Mặc định E2E không lưu screenshot; đặt `LAB_EVIDENCE_DIR` nếu chủ động cần JSON và ảnh bằng chứng. Xem [lệnh chụp bằng chứng](evidence/f13/README.md) và [phương pháp đo](features/protocol-lab.md). Tránh chạy benchmark khác đồng thời khi thu số liệu tham khảo.

Xác minh F13 local ngày 28/10/2026: lint + production build, **154 frontend tests**, **33 backend integration tests**, smoke CLI bốn giao thức và browser E2E F13 đều pass. Số liệu và ảnh của lần chạy thực tế được lưu tại [bằng chứng F13](evidence/f13/README.md). Kết quả không thay thế peer review hoặc nghiệm thu báo cáo/video.

## Admin Dashboard (F12)

`src/features/admin/admin.test.tsx` kiểm tra chặn tài khoản thường, không tự ban, xác nhận/hủy kick/ban/broadcast, thông báo lỗi, giới hạn byte UTF-8 và đăng ký lại queue thống kê sau reconnect. `CollaborationIntegrationTest` kiểm tra phân quyền API, tìm kiếm literal `%`/`_`, phân trang, trạng thái tài khoản đã ban, kênh hoạt động không lộ DM, cùng các thao tác kick/ban/broadcast trên backend thật trong H2.

Browser smoke `e2e/admin.e2e.ts` dùng một tài khoản admin đã tồn tại trên app/MySQL local, kiểm tra login → `/admin`, push thống kê, biểu đồ, tìm kiếm, cấm tự ban, hộp thoại broadcast/hủy bằng Escape, reload và viewport mobile 390px. Test này không gửi broadcast hoặc kick/ban tài khoản thật; các thao tác đó được kiểm tra bằng component/integration tests. Nếu không cung cấp thông tin đăng nhập, browser smoke admin được bỏ qua.

Chạy trong `client/` bằng PowerShell, nhập thông tin tài khoản của bạn khi được hỏi:

```powershell
$env:ADMIN_TEST_EMAIL = Read-Host 'Email admin'
$adminTestSecret = Read-Host 'Mật khẩu admin' -AsSecureString
$env:ADMIN_TEST_PASSWORD = [System.Net.NetworkCredential]::new('', $adminTestSecret).Password
try {
    npm.cmd run test:e2e -- admin.e2e.ts
} finally {
    Remove-Item Env:ADMIN_TEST_EMAIL, Env:ADMIN_TEST_PASSWORD
}
```

Mặc định dùng Chromium của Playwright. Có thể đặt `$env:PLAYWRIGHT_CHANNEL = 'chrome'` để dùng Chrome đã cài trên máy hoặc `'msedge'` cho Edge. Screenshot mặc định tắt; chỉ chụp nếu người chạy chủ động đặt `ADMIN_SCREENSHOT_PATH` đến một file local.

Xác minh local ngày 28/10/2026: Docker build đã chạy lint, **141 frontend tests**, **33 backend integration tests** và build production thành công; browser smoke admin chạy bằng Chrome trên app/MySQL thật đã pass. Kết quả này không thay thế review PR và nghiệm thu báo cáo/video của nhóm.

## CI và cách đọc kết quả

[Workflow](../.github/workflows/ci.yml) build/test, khởi động Compose, chạy smoke và browser E2E, rồi dừng container. Việc sửa workflow local không có nghĩa GitHub Actions đã chạy; xem kết quả từng run trên GitHub sau khi push.

Bàn giao backend ngày 24/10/2026 đã chạy 31 backend integration tests, 76 frontend tests, smoke MySQL/Lab và E2E chat thành công. Đây là mốc kiểm tra trước đợt dọn docs; chạy lại các lệnh trên để xác minh phiên bản đang làm việc. Review PR, kiểm thử UI bổ sung và báo cáo/video được theo dõi riêng trong backlog.
