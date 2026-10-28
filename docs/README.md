# Tài liệu PulseChat

## Bắt đầu

- [Chạy ứng dụng](../README.md)
- [Vận hành](operations.md): cấu hình, Workbench, LAN, volumes và Flyway.
- [Kiểm thử](testing.md): lệnh chạy và phạm vi từng loại test.
- [Phát triển frontend](../client/README.md): Vite proxy và mock mode.

## Tích hợp API

Bắt đầu từ [API index](api/README.md) để xem quy ước chung và chọn đúng contract:

| Tài liệu | Phạm vi |
| --- | --- |
| [Auth](api/auth.md) | F01: đăng ký, login, refresh, logout, `/me` |
| [Realtime](api/realtime.md) | F02: STOMP CONNECT, quyền destination, vòng đời socket |
| [Chat](api/chat.md) | F03–F05/F10: models, kênh, DM, lịch sử và gửi tin |
| [Collaboration](api/collaboration.md) | F06–F12/F14–F15: presence, typing, receipts, notifications, admin, mutations và file |
| [Lab](api/lab.md) | F13: polling, long polling, SSE và raw WebSocket |
| [Whiteboard](api/whiteboard.md) | F19: snapshot, nét vẽ, clear, quyền phòng và retry |

## Thiết kế và kế hoạch

- [Kiến trúc](architecture.md): package boundaries, security và deployment.
- [Thiết kế chat](features/chat.md): membership, transaction, khóa và delivery.
- [Thiết kế collaboration](features/collaboration.md): persistence, quyền và key points.
- [Protocol Lab](features/protocol-lab.md): F13/KP1, workload, phương pháp đo, giới hạn và JSON bằng chứng.
- [Bảng trắng](features/whiteboard.md): F19/KP2, trạng thái lưu trữ, đồng thời và khôi phục kết nối.
- [Backlog và đồng bộ GitHub](backlog/README.md): F01–F21, checklist và quy trình cập nhật issue.

API và tài liệu thiết kế dùng tiếng Anh; hướng dẫn chạy và backlog dùng tiếng Việt. Contract mô tả hành vi backend hiện tại; checklist còn bao gồm việc frontend, review và nghiệm thu.
