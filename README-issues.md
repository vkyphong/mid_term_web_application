# PulseChat – GitHub backlog bootstrap

Gói này gồm một script Bash và ba Markdown issue template. Script tạo **21 issue F01-F21**, labels và **8 milestone theo tuần** từ ngày 14/10/2026. Đây là lịch công việc do PM đề xuất từ charter; tuần 6 chốt Must, tuần 7 đóng băng code, tuần 8 hoàn thiện bàn giao.

## Thành viên

| Biến môi trường | Thành viên | Mảng chính |
| --- | --- | --- |
| `TV1_GH` | Võ Thành Đạt – 52400260 | Frontend |
| `TV2_GH` | Vòng Thế Phong – 52400225 | Backend |
| `TV3_GH` | Nguyễn Thái An – 52400064 | Lab & Admin |

Họ tên/MSSV không đủ để suy ra GitHub username. Điền ba login thực tế, không dùng email, URL hay ký tự @. Script kiểm tra cả ba có thể được assign trong repo trước khi tạo dữ liệu.

## Cài và chạy

Cài GitHub CLI, Git Bash (Windows) hoặc Bash (Linux/macOS). Giải nén và chép `scripts/` cùng `.github/` vào repo, giữ các file đang có. Các template cần được đưa vào default branch bằng PR có một review chấp thuận để xuất hiện khi mở issue.

```bash
gh auth login

# Xem toàn bộ nội dung issue và lệnh dự kiến; không cần gh/token/usernames.
bash scripts/create-issues.sh --dry-run

# Thay ba giá trị sau bằng login GitHub thực tế.
export TV1_GH='login-cua-dat'
export TV2_GH='login-cua-phong'
export TV3_GH='login-cua-an'
export REPO='vkyphong/mid_term_web_application'

bash scripts/create-issues.sh
```

Script dùng `gh issue create --body-file` để giữ đúng Markdown nhiều dòng và literal backticks. Không tự commit/merge template. PR tài liệu gợi ý: `docs: add PulseChat backlog script and issue templates`.

## Danh sách issue

| Fxx | Tiêu đề | Ưu tiên | KP | Tuần / hạn | Phụ trách |
| --- | --- | --- | --- | --- | --- |
| F01 | Đăng ký / đăng nhập JWT | must | KP4 | 2 / 27/10/2026 | TV2 |
| F02 | Xác thực khi handshake WebSocket | must | KP4 | 2 / 27/10/2026 | TV2 |
| F03 | Kênh chat công khai | must | KP3 | 3 / 03/11/2026 | TV1 |
| F04 | Nhắn tin riêng 1-1 | must | KP3 | 3 / 03/11/2026 | TV1 |
| F05 | Lưu và tải lịch sử tin nhắn | must | KP1 | 3 / 03/11/2026 | TV2 |
| F06 | Trạng thái online/offline | must | KP3 | 4 / 10/11/2026 | TV1 |
| F07 | Hiển thị đang gõ | must | KP3 | 4 / 10/11/2026 | TV1 |
| F08 | Đã nhận / đã xem | must | KP3 | 4 / 10/11/2026 | TV1 |
| F09 | Thông báo realtime và @mention | must | KP2, KP3 | 5 / 17/11/2026 | TV1 |
| F10 | Tự kết nối lại và hàng đợi offline | must | KP4 | 5 / 17/11/2026 | TV2 |
| F11 | Rate limiting và kiểm tra đầu vào | must | KP4 | 5 / 17/11/2026 | TV2 |
| F12 | Admin Live Dashboard | must | KP2, KP4 | 6 / 24/11/2026 | TV3 |
| F13 | Protocol Lab | must | KP1 | 6 / 24/11/2026 | TV3 |
| F14 | Sửa / xóa / thả cảm xúc tin nhắn | should | KP3 | 7 / 01/12/2026 | TV1 |
| F15 | Gửi ảnh / file | should | KP1, KP3 | 7 / 01/12/2026 | TV1 |
| F16 | Mở rộng nhiều server | should | KP4 | 7 / 01/12/2026 | TV2 |
| F17 | Heartbeat ping/pong | should | KP1, KP4 | 7 / 01/12/2026 | TV2 |
| F18 | Kiểm thử tải 500–1000 kết nối | should | KP4 | 7 / 01/12/2026 | TV3 |
| F19 | Bảng trắng cộng tác | could | KP2 | 7 / 01/12/2026 | TV3 |
| F20 | Mini game cờ caro 2 người | could | KP2 | 7 / 01/12/2026 | TV3 |
| F21 | Browser Notification khi ẩn tab | could | KP2 | 7 / 01/12/2026 | TV3 |

## Lưu ý vận hành

Labels `priority:*` biểu thị ưu tiên chức năng, không phải mức nghiêm trọng của bug. `fe/be` phản ánh phần việc có triển khai; F16-F18 chủ yếu BE/infra/test dù vẫn có checklist kiểm tra FE. Mỗi issue có owner chính; TV1 thực hiện FE, TV2 BE/infra, TV3 Lab/Admin và điều phối test.

Các Should/Could ở tuần 7 là backlog có điều kiện, không phải cam kết hoàn thành tất cả. Nếu Must chưa xong ở tuần 6, bỏ Could và ưu tiên hoàn thành Must. Không mở rộng ngoài F01-F21. F19/F20 cần chốt payload/sự kiện thuộc chức năng đó trước khi code; danh sách event hiện tại chưa định nghĩa luồng whiteboard/caro.

Mốc kế hoạch: 20/10 chốt phạm vi; 24/11 Must; 01/12 đóng băng code; 08/12 nộp, mục tiêu 07/12 giữ đệm ≥24 giờ. Mốc 08/12 cần điều chỉnh khi có hạn chính thức của Khoa. `due_on` dùng UTC tương ứng 23:59:59 Asia/Saigon.

Chạy lại bỏ qua labels/milestones đang có và issue có tiền tố `[Fxx] `, kể cả issue đã đóng. Script không cập nhật nội dung/assignee/milestone của issue cũ. Milestone cùng tên nhưng đã đóng sẽ làm script dừng trước mutation. Chỉ chạy một bản tại một thời điểm; kiểm tra các feature cũ nếu tiêu đề không còn giữ mã Fxx. Nếu API lỗi, script dừng và trả exit code khác 0; sửa lỗi rồi chạy lại để tiếp tục phần còn thiếu.

## Kiểm tra

```bash
bash -n scripts/create-issues.sh
bash scripts/create-issues.sh --dry-run > backlog-preview.txt

# Sau khi tạo thật:
gh issue list --repo "$REPO" --state all --label type:feature --limit 100 --json title,assignees,labels,milestone
gh api "repos/$REPO/milestones?state=all&per_page=100" --paginate
```

Bản giao đã kiểm tra cú pháp Bash và chạy với GitHub CLI giả lập để kiểm tra 21 payload, gán người/milestone/labels, chạy lại không trùng và lỗi preflight; chưa gọi API ghi vào repo thật.

## Tài liệu chính thức

- [GitHub CLI issue create](https://cli.github.com/manual/gh_issue_create)
- [GitHub CLI label create](https://cli.github.com/manual/gh_label_create)
- [GitHub CLI api](https://cli.github.com/manual/gh_api)
- [GitHub Markdown issue templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates)

