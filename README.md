# PulseChat

Đồ án chat realtime: React 19 + TypeScript, Java 21 + Spring Boot 3.5, MySQL 8.4. Một Spring Boot instance phục vụ cả React, REST và STOMP over WebSocket; chạy toàn bộ bằng Docker Compose.

## Chạy bằng Docker (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init-env.ps1
docker compose up --build -d
docker compose ps
```

Mở **http://localhost:8080**. Đăng ký email bất kỳ thuộc `@DQGM.dev` (ví dụ `dat@DQGM.dev`), mật khẩu ít nhất 8 ký tự có chữ và số. Không cần gửi email xác nhận. Không có tài khoản/mật khẩu mặc định.

Script khởi tạo `.env` với mật khẩu MySQL và JWT secret ngẫu nhiên, giữ nguyên nếu file đã tồn tại. Trên Linux/macOS: copy `.env.example` sang `.env` và thay ba giá trị secret trước khi chạy Compose.

Compose tự tạo database `pulsechat`, user ứng dụng và volume `pulsechat_mysql-data`. Flyway tạo bảng auth và chat (`rooms`, `room_members`, `messages`); Hibernate validate các entity auth, phần chat truy cập qua Spring JDBC với transaction. Lần build đầu cần internet để tải image và dependency, đồng thời chạy test frontend/backend. Không cần cài Java/Maven/Node trên máy để chạy ứng dụng.

## MySQL Workbench

```powershell
docker compose -f compose.yml -f compose.workbench.yml up -d
```

Kết nối `127.0.0.1:3307`, database/user `pulsechat`, password lấy từ `MYSQL_PASSWORD` trong `.env`. Có thể đổi `MYSQL_PORT` khi cổng bị chiếm. Port chỉ mở trên loopback máy chủ; client LAN không truy cập trực tiếp MySQL. Lệnh `docker compose up` thông thường giữ database trong mạng Docker.

## Demo hai máy

Hai máy cùng LAN/Wi-Fi truy cập **http://IP-máy-chủ:8080**; ví dụ `http://192.168.1.10:8080`. Cho phép TCP 8080 qua firewall trên máy chủ khi cần. Dùng IP máy chủ thay cho `localhost` trên máy thứ hai. Frontend tự dùng cùng origin cho REST và `/ws`; không cần rebuild theo IP. Đây là nhiều client dùng một backend.

HTTP local/LAN dùng `COOKIE_SECURE=false`. Nếu triển khai HTTPS, đặt `COOKIE_SECURE=true`. `ALLOWED_ORIGINS` cho phép thêm origin chính xác khi chạy frontend khác cổng; same-origin LAN được chấp nhận. Đổi domain đăng ký phải sửa `ALLOWED_EMAIL_DOMAINS` trong `.env` rồi build lại app để FE/BE thống nhất.

## Cấu trúc

```text
client/                       React: features/auth, features/realtime, features/chat, lib
server/
  src/main/java/dev/pulsechat/
    auth/                     REST, JWT, user/session, repositories
    realtime/                 STOMP auth, connection lifecycle, private probe
    chat/                     REST, STOMP ack/events, membership, persisted messages
    config/                   HTTP security, Origin, SPA forwarding
    common/                   Error contract
  src/main/resources/
    db/migration/             Flyway SQL
  src/test/                   HTTP + real WebSocket integration tests
infra/Dockerfile              Frontend/test/backend/runtime build stages
compose.yml                   App + MySQL
compose.workbench.yml         Optional local DB port
docs/api/                     REST/STOMP contracts
docs/backlog/                 F01–F21 source and manifest
scripts/                      Env initialization, smoke test, issue sync
```

## Phạm vi

- **F01:** đăng ký/login, JWT 15 phút trong memory, refresh HttpOnly cookie 7 ngày, rotation/thu hồi, `/api/auth/me`.
- **F02:** Origin check ở HTTP Upgrade, JWT ở STOMP CONNECT, tối đa 5 kết nối/user, đóng khi hết hạn/logout, private ping/pong và UI trạng thái.
- **F03:** tạo kênh, tham gia/rời kênh, gửi tin đã lưu và broadcast đúng thành viên. Bốn kênh Engineering, HR, Sales, Marketing được tạo một lần bằng migration; người dùng tự chọn tham gia.
- **F04:** tìm nhân viên, mở DM duy nhất cho mỗi cặp, trao đổi riêng đúng hai người. REST và socket đều kiểm tra membership. Retry cùng `clientMsgId` trong một phòng và cùng người gửi không tạo tin trùng.
- **Lịch sử:** API có cursor, mặc định 30 tin gần nhất. UI cuộn tải thêm thuộc F05 và chưa triển khai. Reconnect tải lại danh sách phòng và lịch sử đang mở.
- **F05 trở đi:** các phần còn lại trong backlog. F16 nhiều backend ngoài phạm vi; không có Nginx/Redis. Presence và rate limit tương lai dùng memory một instance, mất state tạm khi restart.

Sau khi đăng nhập, dùng **Duyệt kênh** để tham gia kênh mẫu hoặc **Tạo kênh** để mở kênh mới. Dùng **Tin nhắn mới** để tìm tài khoản nhân viên đã đăng ký và mở DM. Hai trình duyệt/máy dùng tài khoản riêng để thử gửi nhận qua cùng backend. Tin nhắn đã lưu vẫn còn khi reload hoặc restart app.

## Kiểm tra

```powershell
# Build stages chạy test trong Docker
docker build --target frontend-test -t pulsechat-frontend-test -f infra/Dockerfile .
docker build --target backend-test -t pulsechat-backend-test -f infra/Dockerfile .
# Smoke test trên app + MySQL thật đang chạy
docker compose --profile tools run --build --rm --no-deps smoke
# Kiểm tra giao diện thật với 3 phiên Chromium (cần Node trên máy, app đang chạy)
cd client
npm ci
npx playwright install chromium
npm run test:e2e
cd ..
# Đồng bộ issue GitHub (cần Node + gh đã đăng nhập)
node scripts/issues.mjs --dry-run
node scripts/issues.mjs --update-existing
```

Backend test dùng H2 MySQL mode và WebSocket thật để test chạy độc lập trong Docker build. Smoke test kiểm tra MySQL thật, tạo DM đồng thời, membership, ack sau commit, retry và quyền riêng tư. Playwright kiểm tra ba người dùng qua giao diện, reload/reconnect và đo STOMP SEND → frame nhận trên localhost: 20 tin tuần tự, hai thành viên kênh, p95 mục tiêu <200 ms. Đây là workload demo, không khẳng định đạt tải 500/1000 client hoặc heartbeat blackhole F17/F18. Smoke/Playwright tạo tài khoản và phòng thử với tên `smoke-*`/`E2E-*`; không xóa dữ liệu có sẵn. Playwright chạy headless, không chụp ảnh/video/trace và không tạo bộ bằng chứng demo. Thiết kế F03/F04: [channels and direct messages](docs/features/chat.md).

## Vận hành

```powershell
docker compose logs -f app
docker compose stop          # Giữ container và dữ liệu
docker compose down          # Bỏ container/network, giữ volume database
```

Không chạy `docker compose down -v` trừ khi muốn xóa toàn bộ dữ liệu. Đổi mật khẩu `.env` không tự đổi mật khẩu của database đã tồn tại; cần ALTER USER theo quy trình MySQL. Không commit `.env`, token hoặc bản backup GitHub chứa nội dung riêng.

Tài liệu: [architecture](docs/architecture.md), [auth](docs/api/auth.md), [realtime](docs/api/realtime.md), [chat](docs/api/chat.md).
