# PulseChat

Đồ án chat realtime dùng React + TypeScript, Java 21/Spring Boot và MySQL 8.4. Một Spring Boot instance phục vụ giao diện, REST và STOMP over WebSocket; ứng dụng và database chạy bằng Docker Compose.

## Chạy ứng dụng

Chạy tại thư mục gốc bằng Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init-env.ps1
docker compose up --build -d --wait
```

Mở **http://localhost:8080**. Đăng ký email thuộc `@DQGM.dev`, mật khẩu ít nhất 8 ký tự, có chữ và số, tối đa 72 byte UTF-8. Mỗi người dùng tự tạo tài khoản; không có tài khoản mặc định.

Script tạo `.env` chứa secret ngẫu nhiên nếu file chưa tồn tại. Trên Linux/macOS, copy `.env.example` sang `.env` và thay các giá trị secret trước khi chạy Compose. Lần build đầu cần internet và sẽ chạy test frontend/backend; chạy ứng dụng không yêu cầu cài Java, Maven hay Node trên máy.

Flyway tự áp dụng migration khi backend khởi động. MySQL và file upload được giữ trong hai Docker volume riêng.

## Phạm vi

- **F01:** đăng ký/login, JWT 15 phút trong memory, refresh HttpOnly cookie 7 ngày, rotation/thu hồi, `/api/auth/me`.
- **F02:** Origin check ở HTTP Upgrade, JWT ở STOMP CONNECT, tối đa 5 kết nối/user, đóng khi hết hạn/logout, private ping/pong và UI trạng thái.
- **F03:** tạo kênh, tham gia/rời kênh, gửi tin đã lưu và broadcast đúng thành viên. Bốn kênh Engineering, HR, Sales, Marketing được tạo một lần bằng migration; người dùng tự chọn tham gia.
- **F04:** tìm nhân viên, mở DM duy nhất cho mỗi cặp, trao đổi riêng đúng hai người. REST và socket đều kiểm tra membership. Retry cùng `clientMsgId` trong một phòng và cùng người gửi không tạo tin trùng.
- **F05:** lịch sử lưu trong MySQL, tải qua REST có cursor (30 tin/trang). Mở phòng tải 30 tin gần nhất; cuộn lên đầu (hoặc bấm **Tải tin cũ hơn**) tải trang cũ hơn, giữ nguyên vị trí đang đọc, hết thì hiện "Đã hiển thị toàn bộ lịch sử". Tin realtime và tin từ REST gộp theo ID nên không trùng. Reconnect tải lại trang mới nhất; nếu đã lỡ hơn một trang thì đặt lại từ trang mới nhất để không có khoảng trống. Thiết kế: [message history](docs/features/history.md).
- **F06:** chấm online ở DM và mục **Đồng nghiệp** (online / "Hoạt động x phút trước"), cập nhật realtime qua `presence:update`; nhiều tab vẫn online cho tới khi đóng tab cuối.
- **F07:** "… đang gõ…" theo phòng; gửi `typing:start` tối đa 2 giây/lần, `typing:stop` khi ngừng gõ 2,5 giây, khi gửi hoặc rời phòng; tự tắt sau 3 giây.
- **F08:** DM hiện **Đã gửi → Đã nhận → Đã xem** dưới tin mới nhất của mình; kênh hiện số người đã nhận/đã xem trên tổng người nhận lúc gửi. "Đã xem" chỉ gửi khi tab đang hiển thị và tin nằm trong khung nhìn. Thiết kế F06–F08: [presence, typing and receipts](docs/features/presence-typing-receipts.md).
- **F09 trở đi:** các phần còn lại trong backlog. F16 nhiều backend ngoài phạm vi; không có Nginx/Redis. Presence và rate limit tương lai dùng memory một instance, mất state tạm khi restart.
| Phần | Trạng thái triển khai |
| --- | --- |
| F01–F08 | Đã có frontend/backend và e2e trên backend thật |
| F09–F15 | Đã có backend; frontend cần tích hợp theo API |
| F16 | Ngoài phạm vi đồ án; dùng một backend, không Redis/Nginx |
| F17–F21 | Theo dõi riêng trong backlog |

Trạng thái triển khai không thay thế review và nghiệm thu của nhóm. Xem [backlog](docs/backlog/README.md) để theo dõi từng chức năng.

## Tài liệu

| Nhu cầu | Tài liệu |
| --- | --- |
| Tra cứu toàn bộ docs | [Mục lục](docs/README.md) |
| Tích hợp frontend | [REST và realtime API](docs/api/README.md) |
| Hiểu cấu trúc, lưu trữ và bảo mật | [Kiến trúc](docs/architecture.md) |
| Kết nối Workbench, chạy LAN, thêm bảng | [Vận hành](docs/operations.md) |
| Chạy unit, integration, smoke và E2E test | [Kiểm thử](docs/testing.md) |
| Chạy frontend riêng bằng Vite | [Client README](client/README.md) |
| Cập nhật issue GitHub từ backlog | [Đồng bộ issue](docs/backlog/README.md#đồng-bộ-github) |

## Cấu trúc chính

```text
client/                 React, chia theo feature
server/src/main/
  java/dev/pulsechat/    auth, realtime, chat, presence, notification,
                        admin, upload, lab, config, common
  resources/
    db/migration/       Flyway SQL
server/src/test/        Backend integration tests
infra/                  Dockerfile và Maven settings
scripts/                Khởi tạo env, smoke tests, đồng bộ issue
docs/                   API, thiết kế, vận hành và backlog
compose.yml             App + MySQL + upload volume
compose.workbench.yml   Mở cổng MySQL trên loopback khi cần
```
