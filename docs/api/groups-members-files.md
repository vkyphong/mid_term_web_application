# Backend: thành viên, file đính kèm và quản lý group

Tất cả endpoint dùng `Authorization: Bearer <accessToken>`. Group trong tài liệu này là room có `type: "channel"`; DM luôn có đúng hai thành viên và không thuộc phạm vi quản lý group. Đợt bổ sung này chỉ thay backend, không thay giao diện.

## 1. Thành viên

| Method | Endpoint | Body | Thành công | Quyền |
| --- | --- | --- | --- | --- |
| GET | `/api/rooms/{id}/members` | — | `200 { members: RoomMember[] }` | Thành viên hiện tại của room |
| POST | `/api/rooms/{id}/members` | `{ "userId": "<employee-id>" }` | `200 Room` | Thành viên hiện tại của kênh đang mở |

`RoomMember` gồm các trường công khai:

```json
{
  "id": "employee-id",
  "displayName": "Nguyễn An",
  "email": "an@DQGM.dev",
  "enabled": true
}
```

GET trả **toàn bộ** thành viên, bao gồm tài khoản bị khóa với `enabled: false`, sắp theo tên rồi ID. Không phân trang, không giới hạn ở 20 người. Danh sách khớp với `memberCount`; không trả mật khẩu hoặc thông tin session. Thành viên của DM cũng có thể xem hai thành viên của DM đó. Người ngoài không được xem danh sách.

POST chỉ thêm tài khoản tồn tại và đang hoạt động. Gửi lại cùng người đã có trong kênh thành công và không tăng số thành viên. Các request thêm đồng thời được serialize bằng khóa user/room và ràng buộc khóa chính `(room_id, user_id)`. Mọi thành viên hiện tại được phép thêm người; hệ thống chưa có vai trò chủ group/moderator riêng. Không thể thêm người thứ ba vào DM.

Response POST dùng model `Room` hiện có, bổ sung `archived: boolean` và `unreadCount: number` (số tin của người khác chưa xem, mới hơn tin cuối mình đã xem hoặc đã gửi; 0 với kênh chưa tham gia). GET `/api/rooms` cũng bổ sung trường này cho mọi room; DM có `archived: false`. Sau khi thay đổi thành viên, frontend gọi lại danh sách room và thành viên để cập nhật cache. Khi một người **thực sự mới** được thêm (qua API này hoặc API admin), sau khi transaction commit backend gửi cho riêng người đó event `room:added` trên `/user/queue/events`, payload là `Room` nhìn từ phía người được thêm (`joined: true`). Frontend dùng event này để hiện nhóm trong danh sách ngay và báo *Bạn đã được thêm vào nhóm*, không cần tải lại trang. Thêm lại người đã có trong nhóm không phát event.

Để tìm nhân viên trước khi thêm: `GET /api/users?search=<name-or-email>&limit=20` là API tìm kiếm hiện có. Danh sách **thành viên group** ở trên không bị giới hạn bởi tham số `limit` của API tìm nhân viên.

### Tên nhóm, biệt danh, ảnh nhóm

| Method | Endpoint | Body | Thành công | Quyền |
| --- | --- | --- | --- | --- |
| PATCH | `/api/rooms/{id}` | `{ "name": "Tên mới" }` | `200 Room` | Thành viên kênh chưa lưu trữ; tên 2–40 ký tự, trùng → 409 `room_name_taken` |
| PUT | `/api/rooms/{id}/nickname` | `{ "nickname": "Biệt danh" }` | `200 Room` | Thành viên DM; tối đa 40 ký tự, chuỗi rỗng = bỏ biệt danh; kênh → 400 |
| POST | `/api/rooms/{id}/avatar` | multipart `file` (JPEG/PNG ≤ 2 MiB, kiểm tra chữ ký và decode ảnh) | `200 Room` | Thành viên kênh chưa lưu trữ |
| DELETE | `/api/rooms/{id}/avatar` | — | `200 Room` | Như trên |
| GET | `/api/rooms/{id}/avatar` | — | ảnh, `nosniff`, `Content-Security-Policy: sandbox` | Thành viên; chưa có ảnh → 404 |

`Room` bổ sung `nickname` (DM: biệt danh mình đặt cho người kia, khi có thì `name` là biệt danh và tên thật nằm ở `peer.displayName`; người kia không thấy), `avatarUrl` (kênh có ảnh: `/api/rooms/{id}/avatar?v=<thời điểm đổi>`, ngược lại `null`) và `previewMembers` (kênh đã tham gia: tối đa 3 thành viên, người khác trước mình, để ghép avatar mặc định). Đổi tên hoặc ảnh nhóm gửi `room:updated` tới mọi thành viên trên `/user/queue/events`, mỗi người nhận `Room` nhìn từ phía mình; đổi biệt danh chỉ gửi cho chính người đặt. Ảnh nhóm lưu trong thư mục upload, mục `room-avatars/<room-id>`; Flyway V8 thêm `rooms.avatar_media_type`, `rooms.avatar_updated_at` và bảng `room_nicknames`.

## 2. Gửi file

Luồng gửi vẫn dùng upload HTTP trước, sau đó gửi tin bằng STOMP:

1. `POST /api/uploads`, kiểu `multipart/form-data`, gồm `roomId` và phần file tên `file`.
2. Lấy `id` từ response, đưa vào `payload.uploadId` của event `message:send`.
3. Nhận ack và `message:new` với thông tin `attachment`. Backend đã lưu tin trước khi ack thành công.
4. Tải file bằng `GET /api/uploads/{id}` kèm Bearer token. Với trình duyệt, dùng `fetch` lấy Blob để tải; một link thông thường không tự gắn token đang lưu trong memory.

Ví dụ PowerShell, với token và room ID lấy từ phiên đăng nhập thực tế:

```powershell
curl.exe -X POST http://localhost:8080/api/uploads `
  -H "Authorization: Bearer $accessToken" `
  -F "roomId=$roomId" `
  -F "file=@C:/files/report.docx"
```

Response `201`:

```json
{
  "id": "upload-id",
  "roomId": "room-id",
  "filename": "report.docx",
  "mediaType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 10240,
  "url": "/api/uploads/upload-id"
}
```

SEND đến `/app/message.send`, subscribe ack/event theo contract chat hiện có:

```json
{
  "type": "message:send",
  "payload": {
    "roomId": "room-id",
    "content": "",
    "clientMsgId": "33ff76c6-1e3d-4fe9-971a-79f50f584ed6",
    "uploadId": "upload-id"
  },
  "correlationId": "request-uuid",
  "ts": "2026-11-03T00:00:00Z"
}
```

`content` được phép rỗng khi có file. Mỗi tin có một file; có thể gửi nhiều tin để gửi nhiều file. Upload phải thuộc người gửi, cùng room và chưa gắn vào tin khác. Retry vẫn dùng cùng `clientMsgId`, không tạo bản tin trùng. File upload chưa gắn tin chỉ người upload được tải; khi đã gắn tin, thành viên hiện tại của room được tải. Người bị xóa/rời group mất quyền tải. File của tin đã xóa cũng không còn tải được. Admin không được bỏ qua membership để đọc file riêng tư.

### Loại file và giới hạn

| Đuôi file | MIME do backend xác định | Kiểm tra |
| --- | --- | --- |
| `.png` | `image/png` | Chữ ký PNG và decode ảnh |
| `.jpg`, `.jpeg` | `image/jpeg` | Chữ ký JPEG và decode ảnh |
| `.pdf` | `application/pdf` | Chữ ký `%PDF-` |
| `.txt` | `text/plain` | UTF-8 hợp lệ, không chứa ký tự điều khiển nhị phân |
| `.csv` | `text/csv` | UTF-8 hợp lệ; không phân tích cấu trúc bảng |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | ZIP có content types đúng và `word/document.xml` hợp lệ |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ZIP có content types đúng và `xl/workbook.xml` hợp lệ |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | ZIP có content types đúng và `ppt/presentation.xml` hợp lệ |
| `.zip` | `application/zip` | Archive không rỗng, đọc được và có directory hợp lệ |

Mặc định tối đa **100 MB/file**, request multipart tối đa 101 MB, đổi bằng biến môi trường `UPLOAD_MAX_FILE_SIZE` / `UPLOAD_MAX_REQUEST_SIZE`, ảnh tối đa 25 megapixel. Tên file tối đa 200 ký tự; ký tự điều khiển và dấu phân cách đường dẫn được thay bằng `_`. File trên đĩa lưu bằng UUID, không dùng tên do người upload gửi.

Backend không tin MIME từ trình duyệt. TXT/CSV dùng UTF-8; DOC/XLS/PPT đời cũ, định dạng macro-enabled và archive mã hóa không được hỗ trợ. Office có VBA/ActiveX bị từ chối. ZIP giới hạn 20.000 entry; tổng dữ liệu giải nén tối đa gấp 20 lần file gửi lên (ít nhất 25 MiB, nhiều nhất 2 GiB); mỗi XML chính của Office tối đa 32 MiB. Archive có đường dẫn tuyệt đối, `..`, entry trùng hoặc directory bị cắt hỏng bị từ chối. XML không được dùng DTD hoặc external entity. Các kiểm tra này xác định định dạng và giới hạn tài nguyên, không phải quét virus.

Download dùng `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` và `Content-Security-Policy: sandbox`. Không có endpoint public/static để đọc trực tiếp thư mục file. Thư mục lưu file, Docker volume và giới hạn request dùng cấu hình backend hiện có.

## 3. Quản lý group trong admin

Mọi API bên dưới yêu cầu tài khoản `role='admin'` và `enabled=true` trong database. Admin được quản lý metadata/thành viên group mà không cần tham gia group. API này không trả nội dung chat và không áp dụng với DM. API `/api/admin/channels` cũ vẫn là thống kê kênh hoạt động gần đây; danh sách quản lý đầy đủ dùng `/api/admin/groups`.

| Method | Endpoint | Body / query | Thành công |
| --- | --- | --- | --- |
| GET | `/api/admin/groups` | `search=`, `archived=true/false` (tùy chọn), `page=0` | `200 { groups, total, page, pageSize: 20 }` |
| GET | `/api/admin/groups/{id}` | — | `200 Group` |
| POST | `/api/admin/groups` | `{ "name": "Dự án A", "description": "Mô tả" }` | `201 Group`; admin tạo group tự tham gia |
| PATCH | `/api/admin/groups/{id}` | `{ "name": "Tên mới", "description": "Mô tả mới" }` | `200 Group` |
| GET | `/api/admin/groups/{id}/members` | — | `200 { members: RoomMember[] }` |
| POST | `/api/admin/groups/{id}/members` | `{ "userId": "employee-id" }` | `200 Group` |
| DELETE | `/api/admin/groups/{id}/members/{userId}` | — | `200 Group`; xóa lại người đã vắng mặt vẫn thành công |
| POST | `/api/admin/groups/{id}/archive` | `{ "archived": true }` hoặc `{ "archived": false }` | `200 Group` |

`Group`:

```json
{
  "id": "room-id",
  "name": "Dự án A",
  "description": "Mô tả",
  "archived": false,
  "memberCount": 3,
  "lastMessageAt": "2026-11-03T00:00:00Z"
}
```

`description` và `lastMessageAt` có thể được bỏ khỏi JSON khi chưa có giá trị. Danh sách gồm mọi kênh, kể cả chưa từng có tin nhắn, không phụ thuộc cửa sổ hoạt động 60 giây. `search` là chuỗi con của tên kênh, không phân biệt hoa thường; `%` và `_` được hiểu là ký tự thông thường. Không truyền `archived` thì liệt kê cả đang mở và lưu trữ. Số trang bắt đầu từ 0; trang ngoài phạm vi trả danh sách rỗng. `total` là tổng số group khớp bộ lọc.

Tên kênh trim rồi phải dài 2–40 ký tự, duy nhất không phân biệt hoa thường; mô tả tối đa 200 ký tự. PATCH yêu cầu `name`, và `description` bỏ qua/null sẽ xóa mô tả; đây là cập nhật hai trường metadata, không phải JSON Patch tổng quát. API không đổi room type hoặc biến DM thành group.

Lưu trữ giữ nguyên dữ liệu/thành viên và lịch sử để đọc. Group lưu trữ chặn **gửi tin mới, join, thêm thành viên, upload file mới**; người đang ở group vẫn có thể rời, admin vẫn có thể sửa metadata hoặc xóa thành viên. Mở lại group sẽ cho phép các thao tác bị chặn. API không xóa vĩnh viễn group/tin/file. Xóa một người khỏi group chỉ thay membership, không ban tài khoản và không cấm người đó tự join lại một kênh công khai đang mở.

## 4. Lỗi

Response lỗi dùng contract chung `{ "error": { "code", "reason", "message", "details" } }`.

| Trường hợp | HTTP | code / reason |
| --- | --- | --- |
| Thiếu token / token không hợp lệ | 401 | `unauthorized` |
| Không phải admin hoặc không là thành viên | 403 | `forbidden` |
| Thêm người vào DM | 403 | `forbidden` |
| Group không tồn tại; dùng DM ID trong API admin groups | 404 | `invalid_payload` / `not_found` |
| Tên group bị trùng | 409 | `invalid_payload` / `room_name_taken` |
| Group đã lưu trữ | 409 | `invalid_payload` / `room_archived` |
| Body/query sai, tài khoản cần thêm không tồn tại/bị khóa, định dạng file sai | 400 | `invalid_payload` / `validation` |
| Multipart vượt giới hạn servlet | 413 | `invalid_payload` / `file_too_large` |

Giới hạn byte cũng được kiểm tra tại controller; khi gọi controller bằng MockMvc vượt giới hạn trả 400, còn request HTTP vượt giới hạn multipart bị servlet từ chối với 413. Lỗi gửi tin STOMP vẫn trả negative application ack thay vì HTTP status.

## 5. Database và kiểm thử

Flyway V6 thêm `rooms.archived` mặc định false cho dữ liệu cũ. V7 mở rộng `uploads.media_type` lên 128 ký tự để lưu đầy đủ MIME Office. Không sửa migration đã áp dụng hoặc xóa dữ liệu cũ.

Test mới: `server/src/test/java/dev/pulsechat/GroupManagementIntegrationTest.java`, bao gồm phân quyền, thêm đồng thời/idempotence, đầy đủ thành viên bị khóa, group không có tin nhắn, tạo/sửa/xóa membership/lưu trữ, chặn quản lý DM, CORS, file Office/text/ZIP, tải file theo membership và các payload giả mạo.

```powershell
# Nếu có Maven và Java 21 trở lên
cd server
mvn test

# Hoặc kiểm tra backend bằng Docker từ thư mục gốc
docker build --target backend-test -t pulsechat-backend-test -f infra/Dockerfile .
```
