# PulseChat

Đồ án giữa kỳ môn **Lập trình web và ứng dụng (503073)**, chủ đề **WebSockets và giao tiếp thời gian thực**. Ứng dụng chat nội bộ "Tập Đoàn M Chat" dùng React + TypeScript, Java 21/Spring Boot và MySQL 8.4. Một Spring Boot instance phục vụ giao diện, REST và STOMP over WebSocket; ứng dụng và database chạy bằng Docker Compose.

## Thành viên nhóm

| MSSV | Họ và tên | Phụ trách chính |
| --- | --- | --- |
| 52400260 | Võ Thành Đạt | Frontend chat: nhóm, thành viên, file, thông báo, thao tác tin nhắn |
| 52400225 | Vòng Kỷ Phong | Backend: auth, realtime, chat, nhóm, file |
| 52400001 | Nguyễn Thế An | Admin Live Dashboard, Protocol Lab, bảng trắng |

## Yêu cầu hệ thống

| Thành phần | Yêu cầu |
| --- | --- |
| Hệ điều hành | Windows 10/11 (đã kiểm tra), Linux hoặc macOS |
| Docker | Docker Desktop 4.x trở lên (Docker Engine 24+ với Compose v2); đã kiểm tra với Docker 29.8 |
| Phần cứng | RAM trống tối thiểu 4 GB cho Docker (khuyến nghị 8 GB), ổ đĩa trống khoảng 5 GB cho image và volume |
| Mạng | Cần internet ở lần build đầu để tải image và thư viện |
| Cổng | `8080` (ứng dụng); đổi bằng `APP_PORT` trong `.env` nếu bị trùng |
| Trình duyệt | Chrome, Edge hoặc Firefox bản mới |

Chạy ứng dụng **không** cần cài Java, Maven hay Node: mọi thứ được build trong Docker. Chỉ cần Node 22 khi muốn chạy Browser E2E hoặc frontend riêng bằng Vite.

## Chạy ứng dụng

Chạy tại thư mục gốc bằng Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init-env.ps1
docker compose up --build -d --wait
```

Trên Linux/macOS:

```bash
cp .env.example .env   # rồi thay các giá trị replace-with-... bằng chuỗi ngẫu nhiên
docker compose up --build -d --wait
```

Mở **http://localhost:8080**. Lần build đầu mất khoảng 5–10 phút vì chạy luôn lint, unit test frontend và test backend; lệnh trả về khi app đã healthy. Dừng bằng `docker compose down` (dữ liệu vẫn giữ); xoá toàn bộ dữ liệu bằng `docker compose down -v`.

Script tạo `.env` chứa secret ngẫu nhiên nếu file chưa tồn tại. Flyway tự áp dụng migration (V1–V15) khi backend khởi động. MySQL và file upload được giữ trong hai Docker volume riêng.

## Tài khoản demo

| Vai trò | Email | Mật khẩu | Ghi chú |
| --- | --- | --- | --- |
| Admin | `admin@dqgm.dev` | `Admin123456` | Tạo tự động khi backend khởi động; đăng nhập sẽ vào thẳng `/admin` |
| Nhân viên | Tự đăng ký tại `/register` | Tự đặt | Email phải thuộc `@DQGM.dev`; mật khẩu ≥ 8 ký tự, có chữ và số |

Để thử chat realtime, đăng ký 2–3 tài khoản nhân viên và mở mỗi tài khoản ở một cửa sổ ẩn danh / trình duyệt khác nhau. Tài khoản admin demo cấu hình bằng `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_ADMIN_NAME` trong `.env`; đặt `DEMO_ADMIN_EMAIL=` (rỗng) để tắt khi triển khai thật. Nếu email đã được đăng ký trước đó, backend chỉ cấp quyền admin mà không đổi mật khẩu.

## Kiểm thử nhanh

```powershell
# Unit test frontend (lint + Vitest) và backend (JUnit, MockMvc, WebSocket thật) trong Docker
docker build --target frontend-test -f infra/Dockerfile .
docker build --target backend-test -f infra/Dockerfile .

# Browser E2E trên app đang chạy (cần Node 22)
cd client
npm ci
npx playwright install chromium
npm run test:e2e
```

E2E admin dùng sẵn tài khoản admin demo. Chi tiết từng bộ test, smoke test và cách đọc kết quả: [Kiểm thử](docs/testing.md).

## Admin Live Dashboard

Mở **http://localhost:8080/admin** và đăng nhập bằng tài khoản có role `admin`. Đăng nhập thông thường bằng tài khoản admin cũng tự chuyển đến dashboard; từ màn hình chat có liên kết **Admin Dashboard**. Tài khoản `user` không được truy cập trang và API quản trị.

- Thống kê kết nối chat, người online, tin/giây và phòng hoạt động cập nhật mỗi giây qua STOMP; dùng REST mỗi 3 giây khi không nhận được thống kê realtime. Biểu đồ giữ tối đa 60 mẫu trong phút vừa qua, bắt đầu khi mở trang; dữ liệu cũ được đánh dấu khi mất kết nối.
- Danh sách tài khoản có tìm kiếm, phân trang 20 tài khoản và cập nhật mỗi 5 giây. **Kick** đóng kết nối hiện tại, người dùng có thể kết nối lại. **Ban** khóa tài khoản, thu hồi phiên đăng nhập và đóng kết nối. Không tự kick/ban bản thân trên dashboard; chưa có nút mở khóa.
- Kênh hoạt động: tối đa 50 kênh có tin trong 60 giây, số thành viên và số tin/phút; cập nhật mỗi 5 giây. Chỉ số **phòng hoạt động** bao gồm cả kênh và DM, danh sách kênh không hiển thị DM.
- **Broadcast** lưu thông báo hệ thống cho tất cả tài khoản đang được kích hoạt, kể cả offline; người đang kết nối nhận thông báo realtime. Nội dung tối đa 2048 byte UTF-8. Kick, Ban và Broadcast đều có bước xác nhận.

- **Quản lý nhóm:** tìm và lọc nhóm (tất cả / đang hoạt động / đã lưu trữ), tạo nhóm, đổi tên và mô tả, thêm / xoá thành viên (kể cả khi admin không ở trong nhóm), lưu trữ và khôi phục nhóm có xác nhận. Admin không đọc được nội dung chat.

Đăng nhập bằng [tài khoản admin demo](#tài-khoản-demo), hoặc xem [cấp quyền admin](docs/operations.md#tài-khoản-admin) để cấp quyền cho tài khoản khác. Dashboard dùng backend thật, không hỗ trợ chế độ mock.

## Protocol Lab (F13)

Mở **http://localhost:8080/lab** sau khi đăng nhập, hoặc chọn **Protocol Lab** từ chat/dashboard. Tài khoản thường và admin đều truy cập được. Chọn **Tất cả 4 giao thức** để so sánh Polling, Long Polling, SSE và WebSocket thuần với cùng workload; mặc định 20 tin × 128 byte text, khoảng gửi 250 ms, polling 100 ms, khoảng 5 giây/giao thức cộng setup.

Trang hiển thị p50/p95, biểu đồ theo từng tin, số HTTP request/response, header **ước lượng** và overhead frame WS riêng; có nút dừng và tải JSON chứa cấu hình/mẫu đo. Giữ tab ở phía trước; bài lỗi hoặc bị hủy không được đưa vào biểu đồ so sánh. Không dùng chế độ mock. Header không phải số byte bắt gói thực tế; byte handshake WS/TLS/TCP-IP không được cộng giả vào kết quả. Xem [phương pháp đo bằng tiếng Anh](docs/features/protocol-lab.md), [API](docs/api/lab.md) và [kiểm thử](docs/testing.md).

## Bảng trắng cộng tác (F19)

Vào một phòng đã tham gia và chọn tab **Bảng trắng**. Các thành viên có thể cùng vẽ bằng chuột/bút/chạm, chọn màu và độ dày. Nét đã được server xác nhận được lưu trong MySQL; tải lại hoặc kết nối lại sẽ lấy trạng thái mới nhất. **Xóa bảng** cần xác nhận, xóa cho cả phòng và không có hoàn tác. Chỉ thành viên hiện tại của phòng được đọc/vẽ/xóa/nhận nét mới.

Client gom nét thành gói tối đa 48 điểm, gửi tối đa khoảng 5 gói/giây, giữ tối đa 32 gói chưa xác nhận; server có hạn mức vẽ riêng 8 gói/giây/socket, không dùng quota chat. Mỗi bảng tối đa 1000 đoạn, sau đó cần xóa để vẽ tiếp. Khi mất kết nối/đang đồng bộ, vẽ mới bị khóa; thao tác gửi lại giữ nguyên ID để không trùng. Rời bảng sẽ bỏ phần chưa gửi. Không hỗ trợ mock, layer hay undo cộng tác. Xem [contract](docs/api/whiteboard.md), [thiết kế F19/KP2](docs/features/whiteboard.md) và [bằng chứng](docs/evidence/f19/README.md).

Lần chạy `docker compose up --build -d --wait` tiếp theo tự áp dụng migration V5 tạo hai bảng mới; không cần xóa volume hay tạo lại database.

## Phạm vi

- **F01:** đăng ký/login, JWT 15 phút trong memory, refresh HttpOnly cookie 7 ngày, rotation/thu hồi, `/api/auth/me`.
- **F02:** Origin check ở HTTP Upgrade, JWT ở STOMP CONNECT, tối đa 5 kết nối/user, đóng khi hết hạn/logout, private ping/pong và UI trạng thái.
- **F03:** tạo kênh, tham gia/rời kênh, gửi tin đã lưu và broadcast đúng thành viên. Bốn kênh Engineering, HR, Sales, Marketing được tạo một lần bằng migration; người dùng tự chọn tham gia.
- **F04:** tìm nhân viên, mở DM duy nhất cho mỗi cặp, trao đổi riêng đúng hai người. REST và socket đều kiểm tra membership. Retry cùng `clientMsgId` trong một phòng và cùng người gửi không tạo tin trùng.
- **F05:** lịch sử lưu trong MySQL, tải qua REST có cursor (30 tin/trang). Mở phòng tải 30 tin gần nhất; cuộn lên đầu (hoặc bấm **Tải tin cũ hơn**) tải trang cũ hơn, giữ nguyên vị trí đang đọc, hết thì hiện "Đã hiển thị toàn bộ lịch sử". Tin realtime và tin từ REST gộp theo ID nên không trùng. Reconnect tải lại trang mới nhất; nếu đã lỡ hơn một trang thì đặt lại từ trang mới nhất để không có khoảng trống. Thiết kế: [message history](docs/features/history.md).
- **F06:** chấm online ở DM và mục **Đồng nghiệp** (online / "Hoạt động x phút trước"), cập nhật realtime qua `presence:update`; nhiều tab vẫn online cho tới khi đóng tab cuối.
- **F07:** "… đang gõ…" theo phòng; gửi `typing:start` tối đa 2 giây/lần, `typing:stop` khi ngừng gõ 2,5 giây, khi gửi hoặc rời phòng; tự tắt sau 3 giây.
- **F08:** DM hiện **Đã gửi → Đã nhận → Đã xem** dưới tin mới nhất của mình; kênh hiện số người đã nhận/đã xem trên tổng người nhận lúc gửi. "Đã xem" chỉ gửi khi tab đang hiển thị và tin nằm trong khung nhìn. Thiết kế F06–F08: [presence, typing and receipts](docs/features/presence-typing-receipts.md).
- **F09:** chuông thông báo có số chưa đọc, toast khi được @mention hoặc có tin riêng (không cần tải lại), bấm để mở đúng hội thoại; gõ `@` để chọn thành viên phòng; đã đọc đồng bộ giữa các tab. Thông báo `system` (F12) hiển thị không kèm link.
- **F10:** tin gửi khi mất mạng được xếp hàng ("Chờ kết nối để gửi…") và gửi bù đúng thứ tự khi có mạng lại; mất ack thì gửi lại cùng `clientMsgId` nên không trùng; banner báo mất kết nối và số tin đang chờ.
- **F11:** gửi quá 10 tin / 5 giây thì tự chờ rồi gửi tiếp; lỗi `forbidden`/`invalid_payload` hiện lý do dưới tin kèm "Thử lại"; nội dung luôn hiển thị dạng text (không chạy HTML/script).
- **F14:** di chuột vào tin để hiện ba nút như Zalo: **Trả lời** (trích tin gốc, bấm để nhảy tới), **Chuyển tiếp** (hộp "Chia sẻ" tới nhiều nhóm / đồng nghiệp, kèm lời nhắn) và **…** (Lưu về máy, Ghim, Sửa, Thu hồi, Xoá chỉ ở phía tôi). Nút thả cảm xúc (👍 ❤️ 😂 😮 😢 🎉) ở góc dưới bên phải mọi tin. Tin ghim hiện trên đầu đoạn chat; tin thu hồi hiện "Tin nhắn đã được thu hồi" với mọi người. Mọi thay đổi đồng bộ realtime.
- **F15:** gửi ảnh JPEG/PNG, PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP tối đa 100 MB/file, có thanh tiến trình; Ctrl+V dán ảnh từ clipboard (khay tối đa 20 ảnh); ảnh hiển thị lớn trong khung chat, file có nút tải; chỉ thành viên phòng tải được. Thiết kế F09–F15: [notifications](docs/features/notifications-mentions.md), [offline queue and limits](docs/features/offline-queue-limits.md), [message actions and files](docs/features/message-actions-files.md).
- **Nhóm:** tạo nhóm kèm thành viên, thêm người (trưởng nhóm có thể bật chế độ phê duyệt), đổi tên, ảnh nhóm hoặc avatar ghép từ thành viên, trưởng nhóm 🔑 vàng và tối đa 5 phó nhóm 🔑 bạc, `@All`, bình chọn realtime (khoá / mở lại), tìm tin nhắn cũ, mục "Thông tin nhóm" với lịch sử Ảnh/Video, File, Link. Tin nhắn riêng có biệt danh. API: [nhóm, thành viên, file](docs/api/groups-members-files.md).
- **Tài khoản và thông báo:** ảnh đại diện, hồ sơ công khai / riêng tư, số tin chưa đọc do server tính (vòng tròn đỏ, tối đa 5+), âm báo tin mới; chuông chỉ dành cho @mention và thông báo hệ thống.
- **F12:** Admin Live Dashboard, thống kê realtime, tài khoản có tìm kiếm/phân trang, kênh hoạt động, kick/ban và broadcast với xác nhận.
- **F13:** Protocol Lab có giao diện chạy cùng workload qua bốn giao thức, biểu đồ, p50/p95, request/header/frame accounting và JSON export.
- **F19:** Bảng trắng theo phòng, vẽ đồng thời, lưu/khôi phục nét, quyền thành viên và xóa bảng có xác nhận; xem phạm vi và giới hạn ở trên.
- **Các phần còn lại:** theo backlog. F16 nhiều backend ngoài phạm vi; không có Nginx/Redis. Presence và rate limit dùng memory một instance, mất state tạm khi restart.
| Phần | Trạng thái triển khai |
| --- | --- |
| F01–F11, F14, F15 | Đã có frontend/backend và e2e trên backend thật |
| F12 | Đã tích hợp Admin Live Dashboard và quản lý nhóm với backend thật; xem cách chạy ở trên |
| F13 | Đã tích hợp Protocol Lab với backend; xem cách chạy và phạm vi đo ở trên |
| F16 | Ngoài phạm vi đồ án; dùng một backend, không Redis/Nginx |
| F19 | Đã tích hợp bảng trắng; peer review/báo cáo và nghiệm thu tùy chọn theo backlog |
| F17, F18, F20, F21 | Theo dõi riêng trong backlog |

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
