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

| Phần | Trạng thái triển khai |
| --- | --- |
| F01–F04 | Auth, kết nối STOMP, kênh và DM đã có frontend/backend |
| F05–F15 | Đã có backend; frontend các tính năng bổ sung cần tích hợp theo API |
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
