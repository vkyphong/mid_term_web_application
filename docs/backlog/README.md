# Backlog và issue GitHub

Các file `F01.md`–`F21.md` lưu nội dung issue; `manifest.json` lưu tiêu đề, owner mặc định, labels và milestone. Giữ mã F16 để không đổi số hiệu F17–F21.

## Phạm vi và trạng thái

| Nhóm | Nội dung |
| --- | --- |
| [F01](F01.md), [F02](F02.md) | Auth và kết nối STOMP có xác thực |
| [F03](F03.md), [F04](F04.md), [F05](F05.md) | Kênh, DM và lịch sử |
| [F06](F06.md), [F07](F07.md), [F08](F08.md), [F09](F09.md) | Presence, typing, receipts và notifications |
| [F10](F10.md), [F11](F11.md), [F12](F12.md) | Retry, rate limit và admin |
| [F13](F13.md), [F14](F14.md), [F15](F15.md) | Protocol Lab, sửa/xóa/reaction và file |
| [F16](F16.md) | Ngoài phạm vi; đóng với lý do not planned |
| [F17](F17.md), [F18](F18.md) | Heartbeat và kiểm thử tải |
| [F19](F19.md), [F20](F20.md), [F21](F21.md) | Whiteboard, caro và browser notifications |

Backend F01–F15 đã được bàn giao ngày 24/10/2026. Frontend F01–F04 có code; các phần bổ sung do người phụ trách FE tích hợp. Checkbox FE, BE, Test, Docs và tiêu chí nghiệm thu có ý nghĩa riêng; có backend không đồng nghĩa cả issue đã hoàn thành. Review, báo cáo/video và trạng thái GitHub được theo dõi riêng.

Hệ thống dùng một Spring Boot instance + MySQL qua Docker Compose, STOMP over WebSocket cho chat và raw WebSocket riêng cho Lab. Chi tiết ở [kiến trúc](../architecture.md). Quy ước payload, ack và lỗi ở [API index](../api/README.md); lệnh test, phạm vi và mốc kiểm tra ở [kiểm thử](../testing.md).

## Đồng bộ GitHub

Yêu cầu Node và GitHub CLI (`gh`) đã đăng nhập đúng tài khoản. Chạy ở thư mục gốc:

```powershell
gh auth status
node scripts/issues.mjs --dry-run
node scripts/issues.mjs --update-existing
```

`--dry-run` chỉ in nội dung local dự kiến, không gọi GitHub và không so sánh với issue remote. `--update-existing` tạo issue còn thiếu và thay toàn bộ body/title của issue hiện có theo nguồn local. Lệnh không tự commit/push code.

Nếu đã sửa checkbox hoặc nội dung trực tiếp trên GitHub, đưa những thay đổi đó về file nguồn trước khi đồng bộ để tránh ghi đè. Script giữ assignee, labels và milestone của issue hiện có; nó không tự đóng issue đã triển khai. Riêng F16 được đóng theo quyết định ngoài phạm vi.

Script lưu snapshot vào `.local/issue-backups/` trước khi thay đổi GitHub. Đây là bản backup local, không commit vào repo. Tài liệu trong `docs/` được hiển thị đầy đủ trên GitHub khi đã commit/push.

Chạy `node scripts/issues.mjs` không có flag để chỉ tạo các issue còn thiếu và bỏ qua issue hiện hữu. Khi tạo issue mới, cấu hình `TV1_GH`, `TV2_GH`, `TV3_GH` theo owner trong manifest. Có thể đổi repo đích bằng biến `REPO` (mặc định `vkyphong/mid_term_web_application`). `scripts/create-issues.sh` là wrapper cho cùng script Node.
