# Vận hành

Các lệnh chạy ở thư mục gốc. Xem [README](../README.md) cho lần khởi động đầu tiên và [kiểm thử](testing.md) cho các bước xác minh.

## Cấu hình

Root `.env` được Docker Compose đọc. `scripts/init-env.ps1` tạo file nếu chưa có và giữ nguyên file hiện hữu. Không commit secret hoặc nội dung `.env`.

| Biến | Mục đích |
| --- | --- |
| `APP_PORT` | Cổng ứng dụng, mặc định 8080 |
| `MYSQL_DATABASE`, `MYSQL_USER` | Database và user ứng dụng, mặc định `pulsechat` |
| `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | Mật khẩu MySQL |
| `JWT_SECRET` | Secret ký JWT; tối thiểu 32 ký tự |
| `ALLOWED_EMAIL_DOMAINS` | Domain đăng ký, mặc định `DQGM.dev`; danh sách phân cách dấu phẩy |
| `ALLOWED_ORIGINS` | Danh sách origin bổ sung, phân cách dấu phẩy |
| `COOKIE_SECURE` | `false` cho HTTP local/LAN; `true` khi dùng HTTPS |
| `ACCESS_TTL_SECONDS` | Thời hạn access token, mặc định 900 giây |
| `MYSQL_PORT` | Cổng Workbench tùy chọn, mặc định 3307 |

Đổi `ALLOWED_EMAIL_DOMAINS` cần build lại app vì giá trị tương ứng của frontend được nhúng khi build. `.env.example` trong client là file mẫu; `.env.test` của client dành cho Vitest. Xem [Client README](../client/README.md) nếu chạy Vite riêng.

Đổi mật khẩu trong `.env` không tự đổi mật khẩu của database đã tồn tại; cập nhật user MySQL tương ứng trước khi khởi động lại với cấu hình mới.

## MySQL Workbench

```powershell
docker compose -f compose.yml -f compose.workbench.yml up -d
```

Kết nối `127.0.0.1:3307`, dùng database/user từ `.env` và `MYSQL_PASSWORD`. Cổng chỉ mở trên loopback máy chủ; client LAN truy cập qua API. Khi cần giữ cổng Workbench ở các lệnh `up` tiếp theo, tiếp tục dùng cả hai file Compose.

Tài khoản đăng ký mặc định có role `user`. Để dùng API admin, người vận hành chỉnh `users.role` của đúng tài khoản đã đăng ký thành `admin` trong MySQL. Đăng nhập/refresh lại để frontend nhận role mới. Quyền backend luôn được kiểm tra theo database.

## Truy cập từ hai máy

Hai máy cùng LAN/Wi-Fi mở `http://IP-máy-chủ:8080`; cho phép TCP 8080 qua firewall máy chủ nếu cần. Máy thứ hai dùng IP máy chủ thay cho `localhost`. Frontend dùng cùng origin cho REST và `/ws`, không cần build lại theo IP.

Với frontend chạy ở origin khác, thêm origin chính xác vào `ALLOWED_ORIGINS`. Khi triển khai HTTPS, cấu hình `COOKIE_SECURE=true` và dùng `wss://` cho WebSocket.

## Volumes và vòng đời ứng dụng

| Volume | Dữ liệu |
| --- | --- |
| `pulsechat_mysql-data` | Database |
| `pulsechat_uploads-data` | File upload trong `/app/uploads` |

Tên trên dùng project mặc định `pulsechat`; đổi Compose project name sẽ đổi prefix volume. Sao lưu database và upload cùng nhau. Upload chưa gửi thành tin nhắn hiện vẫn được giữ trên disk.

```powershell
docker compose ps
docker compose logs -f app
docker compose stop
docker compose down
```

`stop` và `down` giữ volumes. `docker compose down -v` xóa volumes và dữ liệu.

## Thêm bảng bằng Flyway

Migration nằm trong `server/src/main/resources/db/migration/`. Tạo file kế tiếp, ví dụ `V5__create_example.sql`, rồi bổ sung code truy cập bảng. Thêm entity nếu feature dùng JPA; các feature dùng JDBC không cần entity JPA.

```powershell
docker compose up --build -d --wait
```

Flyway tự áp dụng migration mới khi Spring Boot khởi động và ghi vào `flyway_schema_history`. Không chỉnh file migration đã được áp dụng. `restart` đơn thuần không build SQL/code mới vào image.

V4 thêm unique key `(sender_id, client_msg_id)` trên toàn bộ phòng. Trước khi nâng từ dữ liệu V3, kiểm tra collision trong Workbench:

```sql
SELECT sender_id, client_msg_id, COUNT(*)
FROM messages
GROUP BY sender_id, client_msg_id
HAVING COUNT(*) > 1;
```

Nếu có kết quả, cần xử lý dữ liệu trước khi migrate; migration không tự sửa ID hoặc xóa tin. Các tin cũ không được tự suy ra tập người nhận lịch sử; receipts được chụp tại thời điểm tạo tin mới.
