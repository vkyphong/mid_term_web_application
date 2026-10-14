#!/usr/bin/env bash
# PulseChat F01-F21 backlog. Requires Bash + GitHub CLI; use Git Bash on Windows.
# Run from any directory; templates are delivered separately for a reviewed PR.
set -euo pipefail

REPO="${REPO:-vkyphong/mid_term_web_application}"
DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --help|-h)
    printf '%s\n' 'Usage: TV1_GH=<Dat login> TV2_GH=<Phong login> TV3_GH=<An login> bash scripts/create-issues.sh [--dry-run]'
    exit 0 ;;
  "") ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
if (( $# > 1 )); then printf '%s\n' 'Use at most one option.' >&2; exit 2; fi

if (( DRY_RUN )); then
  TV1_GH="${TV1_GH:-TV1_LOGIN}"
  TV2_GH="${TV2_GH:-TV2_LOGIN}"
  TV3_GH="${TV3_GH:-TV3_LOGIN}"
else
  : "${TV1_GH:?Set TV1_GH to Dat GitHub login}"
  : "${TV2_GH:?Set TV2_GH to Phong GitHub login}"
  : "${TV3_GH:?Set TV3_GH to An GitHub login}"
fi
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { printf '%s\n' 'REPO must be owner/name.' >&2; exit 2; }

# Print commands without running them in preview mode.
run() {
  if (( DRY_RUN )); then printf '+ '; printf '%q ' "$@"; printf '\n';
  else "$@"; fi
}

EXISTING_LABELS=""
EXISTING_MILESTONES=""
EXISTING_ISSUES=""
if (( ! DRY_RUN )); then
  command -v gh >/dev/null || { printf '%s\n' 'Install GitHub CLI first.' >&2; exit 1; }
  gh auth status
  ready="$(gh api "repos/$REPO" --jq '(.has_issues == true and .archived == false)')"
  [[ "$ready" == true ]] || { printf '%s\n' 'Repository is archived or Issues are disabled.' >&2; exit 1; }
  # Verify all three assignees before any mutation; names/MSSV are not GitHub logins.
  for login in "$TV1_GH" "$TV2_GH" "$TV3_GH"; do
    [[ "$login" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || { printf 'Invalid GitHub login: %s\n' "$login" >&2; exit 2; }
    gh api "repos/$REPO/assignees/$login" --silent
  done
  EXISTING_LABELS="$(gh api "repos/$REPO/labels?per_page=100" --paginate --jq '.[].name')"
  EXISTING_MILESTONES="$(gh api "repos/$REPO/milestones?state=all&per_page=100" --paginate --jq '.[] | [.title,.state] | @tsv')"
  # Include closed issues; exclude pull requests. Pagination avoids a fixed 1000-item limit.
  EXISTING_ISSUES="$(gh api "repos/$REPO/issues?state=all&per_page=100" --paginate --jq '.[] | select(has("pull_request") | not) | .title')"
fi

# Create missing labels only; existing label descriptions/colors remain as configured.
create_label() {
  local name="$1" color="$2" description="$3"
  if (( ! DRY_RUN )) && grep -Fxq -- "$name" <<< "$EXISTING_LABELS"; then
    printf 'SKIP label: %s\n' "$name"; return 0
  fi
  run gh label create "$name" --repo "$REPO" --color "$color" --description "$description"
}

# Reuse open milestones by exact title. A closed planned milestone needs PM review.
check_milestone() {
  local title="$1" existing state
  while IFS=$'\t' read -r existing state; do
    if [[ "$existing" == "$title" && "$state" != open ]]; then
      printf 'Planned milestone is closed: %s. Reopen or revise the schedule before running.\n' "$title" >&2
      exit 1
    fi
  done <<< "$EXISTING_MILESTONES"
}
create_milestone() {
  local title="$1" due="$2" description="$3" existing state
  while IFS=$'\t' read -r existing state; do
    if [[ "$existing" == "$title" ]]; then printf 'SKIP milestone: %s\n' "$title"; return 0; fi
  done <<< "$EXISTING_MILESTONES"
  run gh api --method POST "repos/$REPO/milestones" --raw-field "title=$title" \
    --raw-field "due_on=$due" --raw-field "description=$description" --silent
}

# Validate planned milestone states before changing any labels/milestones.
check_milestone 'W01 - Tuần 1'
check_milestone 'W02 - Tuần 2'
check_milestone 'W03 - Tuần 3'
check_milestone 'W04 - Tuần 4'
check_milestone 'W05 - Tuần 5'
check_milestone 'W06 - Tuần 6'
check_milestone 'W07 - Tuần 7'
check_milestone 'W08 - Tuần 8'

# Labels
create_label 'priority:must' 'B60205' 'Must F01-F13: đạt nghiệm thu trước cuối tuần 6'
create_label 'priority:should' 'FBCA04' 'Should F14-F18: sau Must, trước đóng băng code'
create_label 'priority:could' 'C5DEF5' 'Could F19-F21: chỉ khi Must đạt và còn thời gian'
create_label 'KP1' '1D76DB' 'HTTP vs WebSocket và Protocol Lab'
create_label 'KP2' '5319E7' 'Real-time use cases'
create_label 'KP3' '0052CC' 'Events, broadcasting, server push'
create_label 'KP4' 'D93F0B' 'Bảo mật và kết nối đồng thời'
create_label 'fe' '0E8A16' 'Frontend React/TypeScript'
create_label 'be' '006B75' 'Backend/API/socket/data/infra'
create_label 'type:feature' 'A2EEEF' 'Chức năng F01-F21 đã chốt'
create_label 'type:bug' 'D73A4A' 'Lỗi trong chức năng đã chốt'
create_label 'type:task' 'D4C5F9' 'Công việc con của phạm vi đã chốt'
create_label 'test' 'BFD4F2' 'Kiểm thử và bằng chứng nghiệm thu'
create_label 'docs' '0075CA' 'Báo cáo, README và tài liệu'
create_label 'area:lab' 'BFDADC' 'Protocol Lab/đo giao thức'
create_label 'area:admin' 'E4E669' 'Admin Live Dashboard'
create_label 'infra' 'C2E0C6' 'Docker, Nginx, Redis, multi-instance'

# Week ends at 23:59:59 Asia/Saigon (+07:00); due_on is UTC.
create_milestone 'W01 - Tuần 1' '2026-10-20T16:59:59Z' '14/10-20/10: chốt F01-F21, tiêu chí nghiệm thu, RACI, event contract và Figma ban đầu.'
create_milestone 'W02 - Tuần 2' '2026-10-27T16:59:59Z' '21/10-27/10: nền tảng auth và handshake (F01-F02); bắt đầu viết báo cáo.'
create_milestone 'W03 - Tuần 3' '2026-11-03T16:59:59Z' '28/10-03/11: kênh, DM, lưu và lịch sử (F03-F05).'
create_milestone 'W04 - Tuần 4' '2026-11-10T16:59:59Z' '04/11-10/11: presence, typing, receipts (F06-F08).'
create_milestone 'W05 - Tuần 5' '2026-11-17T16:59:59Z' '11/11-17/11: notification, reconnect, bảo mật đầu vào (F09-F11).'
create_milestone 'W06 - Tuần 6' '2026-11-24T16:59:59Z' '18/11-24/11: admin, Protocol Lab (F12-F13); nghiệm thu toàn bộ Must và KP1-KP4.'
create_milestone 'W07 - Tuần 7' '2026-12-01T16:59:59Z' '25/11-01/12: Should F14-F18; Could F19-F21 chỉ khi Must đạt và còn thời gian; đóng băng code. Nếu còn Must, bỏ Could và ưu tiên Must.'
create_milestone 'W08 - Tuần 8' '2026-12-08T16:59:59Z' '02/12-08/12: chỉ sửa lỗi, hoàn thiện báo cáo/video/slide/README; mục tiêu nộp 07/12, giữ đệm >=24 giờ. 08/12 là hạn kế hoạch, cập nhật theo hạn Khoa.'

WORK_DIR="$(mktemp -d)"
# Only remove the body files this script owns; no recursive deletion.
cleanup() { rm -f -- "$WORK_DIR"/F[0-9][0-9].md; rmdir -- "$WORK_DIR"; }
trap cleanup EXIT

# Consume a quoted heredoc, preserving literal backticks, dollar signs and newlines.
create_issue() {
  local id="$1" title="$2" labels="$3" milestone="$4" assignee="$5" existing
  cat > "$WORK_DIR/$id.md"
  if (( ! DRY_RUN )); then
    while IFS= read -r existing; do
      if [[ "$existing" == "[$id] "* ]]; then printf 'SKIP existing feature: %s\n' "$id"; return 0; fi
    done <<< "$EXISTING_ISSUES"
  fi
  printf '\nFeature %s | assignee @%s | %s\n' "$id" "$assignee" "$milestone"
  if (( DRY_RUN )); then cat "$WORK_DIR/$id.md"; fi
  run gh issue create --repo "$REPO" --title "$title" --body-file "$WORK_DIR/$id.md" \
    --label "$labels" --milestone "$milestone" --assignee "$assignee"
}

create_issue 'F01' '[F01] Đăng ký / đăng nhập JWT' 'type:feature,priority:must,KP4,fe,be' 'W02 - Tuần 2' "$TV2_GH" <<'BODY_F01'
## Mô tả
Cung cấp đăng ký, đăng nhập, refresh và đăng xuất cho email thuộc domain công ty.

**Chức năng:** F01 · **Key points:** KP4 · **Ưu tiên:** MUST
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W02 - Tuần 2 · **Phụ thuộc:** Không.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Form đăng ký/đăng nhập, lỗi domain và trạng thái phiên; gọi REST auth bằng TanStack Query.
- [ ] **BE:** POST /api/auth/register|login|refresh|logout; bcrypt; access token 15 phút, refresh token 7 ngày; kiểm tra chính xác domain từ cấu hình và vô hiệu refresh token khi logout.
- [ ] **Test:** Supertest: domain hợp lệ/sai, email trùng, mật khẩu sai, refresh hết hạn và logout; không so khớp domain bằng contains/endsWith thiếu dấu @.
- [ ] **Docs:** Viết nội dung F01/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Đăng ký ngoài domain bị từ chối; phiên hoạt động đúng thời hạn; logout không thể dùng refresh token cũ.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F01 ...` / `fix: F01 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F01

create_issue 'F02' '[F02] Xác thực khi handshake WebSocket' 'type:feature,priority:must,KP4,fe,be' 'W02 - Tuần 2' "$TV2_GH" <<'BODY_F02'
## Mô tả
Chỉ chấp nhận kết nối Socket.IO có JWT hợp lệ, đúng Origin và tài khoản được phép.

**Chức năng:** F02 · **Key points:** KP4 · **Ưu tiên:** MUST
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W02 - Tuần 2 · **Phụ thuộc:** F01.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Truyền token khi handshake; hiển thị unauthorized; refresh một lần theo luồng phiên và reconnect sau refresh.
- [ ] **BE:** Middleware handshake kiểm tra JWT, Origin whitelist, banned; giới hạn 5 socket/user trên toàn hệ thống; ngắt socket khi access token hết hạn.
- [ ] **Test:** Token thiếu/sai/hết hạn, Origin lạ, user bị ban, socket thứ 6; không tạo vòng lặp refresh/reconnect.
- [ ] **Docs:** Viết nội dung F02/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Socket trái phép bị từ chối; token hết hạn khiến kết nối bị ngắt và client chỉ reconnect với token hợp lệ.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F02 ...` / `fix: F02 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F02

create_issue 'F03' '[F03] Kênh chat công khai' 'type:feature,priority:must,KP3,fe,be' 'W03 - Tuần 3' "$TV1_GH" <<'BODY_F03'
## Mô tả
Tạo, tham gia và rời kênh theo phòng ban hoặc dự án; broadcast tin nhắn tới thành viên.

**Chức năng:** F03 · **Key points:** KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W03 - Tuần 3 · **Phụ thuộc:** F01, F02.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Danh sách/tạo kênh và UI join/leave; dữ liệu mẫu Engineering, HR, Sales, Marketing.
- [ ] **BE:** GET/POST /api/rooms; room:join, room:leave, message:send (ack), message:new; kiểm tra quyền trước join/send, lưu tin trước ack.
- [ ] **Test:** Playwright nhiều client: chỉ thành viên nhận broadcast; rời kênh không nhận sự kiện tiếp; đo độ trễ localhost.
- [ ] **Docs:** Viết nội dung F03/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Chat kênh hoạt động giữa nhiều cửa sổ, đúng phòng nhận tin, độ trễ localhost <200 ms với workload được ghi rõ.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F03 ...` / `fix: F03 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F03

create_issue 'F04' '[F04] Nhắn tin riêng 1-1' 'type:feature,priority:must,KP3,fe,be' 'W03 - Tuần 3' "$TV1_GH" <<'BODY_F04'
## Mô tả
Cho hai nhân viên trao đổi riêng, không phát tin tới người thứ ba.

**Chức năng:** F04 · **Key points:** KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W03 - Tuần 3 · **Phụ thuộc:** F02, F03.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Tìm nhân viên qua GET /api/users?search=; mở cuộc trò chuyện và UI tin riêng.
- [ ] **BE:** Room type dm với đúng hai thành viên, tránh tạo trùng cùng cặp; membership check ở REST và socket; message:send (ack)/message:new.
- [ ] **Test:** Ba user: hai bên nhận tin, user thứ ba bị forbidden khi join/send/tải lịch sử; hai thao tác tạo DM đồng thời không tạo phòng trùng.
- [ ] **Docs:** Viết nội dung F04/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Chỉ hai thành viên được nhận và đọc tin nhắn của cuộc trò chuyện.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F04 ...` / `fix: F04 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F04

create_issue 'F05' '[F05] Lưu và tải lịch sử tin nhắn' 'type:feature,priority:must,KP1,fe,be' 'W03 - Tuần 3' "$TV2_GH" <<'BODY_F05'
## Mô tả
Lưu MongoDB và tải lịch sử qua REST có phân trang theo con trỏ.

**Chức năng:** F05 · **Key points:** KP1 · **Ưu tiên:** MUST
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W03 - Tuần 3 · **Phụ thuộc:** F02, F03.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Cuộn lên tải thêm bằng TanStack Query; hợp nhất lịch sử và message:new theo ID.
- [ ] **BE:** GET /api/rooms/:id/messages?before=&limit=30; index room/thời gian/ID; kiểm tra membership; thứ tự ổn định và giới hạn tối đa.
- [ ] **Test:** 30 tin/lần, cursor biên, nhiều tin cùng timestamp, tin mới đến lúc tải; user ngoài DM bị từ chối.
- [ ] **Docs:** Viết nội dung F05/KP1 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Tin vẫn tồn tại sau restart; phân trang không trùng/thiếu trên tập dữ liệu ổn định; REST và realtime hiển thị thống nhất.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F05 ...` / `fix: F05 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP1 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F05

create_issue 'F06' '[F06] Trạng thái online/offline' 'type:feature,priority:must,KP3,fe,be' 'W04 - Tuần 4' "$TV1_GH" <<'BODY_F06'
## Mô tả
Đồng bộ presence chính xác khi người dùng mở nhiều tab hoặc đóng kết nối.

**Chức năng:** F06 · **Key points:** KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W04 - Tuần 4 · **Phụ thuộc:** F02, F03.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Danh sách online và lastSeen; cập nhật Zustand từ presence:update.
- [ ] **BE:** Theo dõi số socket/user bằng Redis; chỉ offline khi không còn socket; phát presence:update và cập nhật lastSeen.
- [ ] **Test:** Mở hai tab, đóng một tab vẫn online, đóng tab cuối thành offline; reconnect không tạo trạng thái dư.
- [ ] **Docs:** Viết nội dung F06/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Presence cập nhật ngay khi join/disconnect bình thường và đúng với nhiều tab; kết nối chết được kiểm tra bổ sung ở F17.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F06 ...` / `fix: F06 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F06

create_issue 'F07' '[F07] Hiển thị đang gõ' 'type:feature,priority:must,KP3,fe,be' 'W04 - Tuần 4' "$TV1_GH" <<'BODY_F07'
## Mô tả
Hiển thị typing trong đúng kênh hoặc DM, tự ẩn khi người gửi ngừng gõ.

**Chức năng:** F07 · **Key points:** KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W04 - Tuần 4 · **Phụ thuộc:** F03, F04.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Throttle typing:start; typing:stop khi dừng/gửi/rời phòng; TTL hiển thị 3 giây.
- [ ] **BE:** Validate typing:start/typing:stop và membership; lấy userId từ JWT rồi relay trong đúng phòng.
- [ ] **Test:** Vitest fake timers kiểm tra throttle và 3 giây; Playwright xác nhận không lộ typing sang phòng khác.
- [ ] **Docs:** Viết nội dung F07/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Đang gõ hiển thị realtime, tự tắt sau 3 giây không có cập nhật và không phát sự kiện liên tục theo từng phím.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F07 ...` / `fix: F07 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F07

create_issue 'F08' '[F08] Đã nhận / đã xem' 'type:feature,priority:must,KP3,fe,be' 'W04 - Tuần 4' "$TV1_GH" <<'BODY_F08'
## Mô tả
Đồng bộ trạng thái sent → delivered → seen cho tin nhắn.

**Chức năng:** F08 · **Key points:** KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W04 - Tuần 4 · **Phụ thuộc:** F04, F05.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Hiển thị trạng thái; phát delivered khi nhận, seen khi hội thoại được mở và tin nằm trong vùng xem; hỗ trợ nhiều tab.
- [ ] **BE:** message:delivered/message:seen hai chiều; receipts theo từng người nhận; xác thực userId, membership; cập nhật idempotent và không lùi trạng thái.
- [ ] **Test:** Người gửi không giả mạo receipt người nhận; seen không phát khi tab/hội thoại chưa xem; nhiều tab và sự kiện trùng không làm lùi trạng thái.
- [ ] **Docs:** Viết nội dung F08/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] DM thể hiện đủ ba trạng thái; với kênh, ghi rõ quy tắc tổng hợp trạng thái từ receipts của từng thành viên.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F08 ...` / `fix: F08 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F08

create_issue 'F09' '[F09] Thông báo realtime và @mention' 'type:feature,priority:must,KP2,KP3,fe,be' 'W05 - Tuần 5' "$TV1_GH" <<'BODY_F09'
## Mô tả
Thông báo khi có tin riêng mới hoặc được @mention trong kênh.

**Chức năng:** F09 · **Key points:** KP2, KP3 · **Ưu tiên:** MUST
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W05 - Tuần 5 · **Phụ thuộc:** F04, F05, F06.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Chọn @mention từ nhân viên hợp lệ; badge, toast và link mở đúng hội thoại.
- [ ] **BE:** Lưu notifications; notification:new vào room của người nhận, type mention/dm/system; chỉ gửi tới người có quyền đọc hội thoại.
- [ ] **Test:** DM/mention tới đúng user, không lộ thông báo cho user khác; nhiều tab và retry message không tạo thông báo trùng.
- [ ] **Docs:** Viết nội dung F09/KP2/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Badge/toast xuất hiện không reload; link mở đúng tin/hội thoại; xử lý type system cho F12.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F09 ...` / `fix: F09 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP2/KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F09

create_issue 'F10' '[F10] Tự kết nối lại và hàng đợi offline' 'type:feature,priority:must,KP4,fe,be' 'W05 - Tuần 5' "$TV2_GH" <<'BODY_F10'
## Mô tả
Reconnect bằng backoff và gửi bù tin offline mà không tạo bản ghi trùng.

**Chức năng:** F10 · **Key points:** KP4 · **Ưu tiên:** MUST
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W05 - Tuần 5 · **Phụ thuộc:** F01, F02, F05.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Trạng thái kết nối và hàng đợi; giữ nguyên clientMsgId khi retry; flush sau reconnect/auth hợp lệ, xử lý ack timeout.
- [ ] **BE:** message:send ack sau lưu; unique index theo senderId + clientMsgId, trả lại kết quả tin đã lưu khi retry; rejoin phòng được phép.
- [ ] **Test:** Playwright ngắt mạng, gửi nhiều tin, reconnect; mô phỏng mất ack sau khi DB đã lưu; retry không trùng DB/UI.
- [ ] **Docs:** Viết nội dung F10/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Tin offline được gửi bù đúng thứ tự của hàng đợi; mỗi clientMsgId chỉ tạo một tin cho cùng người gửi.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F10 ...` / `fix: F10 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F10

create_issue 'F11' '[F11] Rate limiting và kiểm tra đầu vào' 'type:feature,priority:must,KP4,fe,be' 'W05 - Tuần 5' "$TV2_GH" <<'BODY_F11'
## Mô tả
Chặn spam, payload sai/lớn và XSS trên các luồng nhận dữ liệu.

**Chức năng:** F11 · **Key points:** KP4 · **Ưu tiên:** MUST
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W05 - Tuần 5 · **Phụ thuộc:** F02, F03.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Hiển thị rate_limited/invalid_payload/forbidden; không render nội dung bằng HTML không kiểm soát.
- [ ] **BE:** Redis limit tối đa 10 tin/5 giây/socket; zod, giới hạn content ≤2 KB theo byte UTF-8, maxHttpBufferSize phù hợp; xử lý XSS ở server và render text.
- [ ] **Test:** Biên 10/11 tin, reset cửa sổ hạn chế, emoji vượt 2 KB, payload 1 MB, XSS và truy cập trái phép.
- [ ] **Docs:** Viết nội dung F11/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Không vượt hạn mức; mã lỗi thống nhất; payload độc hại không thực thi, payload sai/lớn bị từ chối.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F11 ...` / `fix: F11 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F11

create_issue 'F12' '[F12] Admin Live Dashboard' 'type:feature,priority:must,KP2,KP4,fe,be,area:admin' 'W06 - Tuần 6' "$TV3_GH" <<'BODY_F12'
## Mô tả
IT Admin theo dõi kết nối, tin/giây, kênh hoạt động; kick/ban và broadcast.

**Chức năng:** F12 · **Key points:** KP2, KP4 · **Ưu tiên:** MUST
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W06 - Tuần 6 · **Phụ thuộc:** F02, F03, F06, F11.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Trang admin, biểu đồ/số liệu, thao tác kick/ban/broadcast và thông báo kết quả.
- [ ] **BE:** Role guard; admin:stats server push mỗi giây tới admin room; admin:kick, admin:broadcast và POST /api/admin/users/:id/ban; ban chặn đăng nhập/refresh/kết nối mới và ngắt socket hiện có.
- [ ] **Test:** User thường bị forbidden; stats đúng khi mở/đóng socket; kick ngắt toàn bộ socket user, ban vẫn có hiệu lực khi reconnect; broadcast tới user hợp lệ.
- [ ] **Docs:** Viết nội dung F12/KP2/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Chỉ admin thao tác/xem stats; push mỗi giây; định nghĩa rõ connections, msgPerSec, active rooms; khi F16 bật, số liệu và thao tác áp dụng toàn cụm.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F12 ...` / `fix: F12 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP2/KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F12

create_issue 'F13' '[F13] Protocol Lab' 'type:feature,priority:must,KP1,fe,be,area:lab' 'W06 - Tuần 6' "$TV3_GH" <<'BODY_F13'
## Mô tả
So sánh Polling, Long Polling, SSE và WebSocket thuần bằng cùng workload.

**Chức năng:** F13 · **Key points:** KP1 · **Ưu tiên:** MUST
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W06 - Tuần 6 · **Phụ thuộc:** F01, F11.
**Mốc bắt buộc:** đạt nghiệm thu chậm nhất 24/11/2026.

## Checklist công việc con
- [ ] **FE:** Trang Lab chọn giao thức, chạy thử và biểu đồ latency, số request, byte header; hiển thị cấu hình đo.
- [ ] **BE:** /api/lab/poll, /api/lab/long-poll, /api/lab/sse; ws chỉ cho Lab; lab:ping/lab:pong theo envelope; kiểm soát truy cập và dọn kết nối.
- [ ] **Test:** Workload/tần suất/kích thước/thời lượng giống nhau; đo cùng loại latency với cách xử lý lệch đồng hồ; đếm request và đo/ghi rõ cách ước lượng byte header.
- [ ] **Docs:** Viết nội dung F13/KP1 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Có kết quả của đủ 4 giao thức, p50/p95 latency, request count và header bytes; tách HTTP handshake, WS frame overhead, payload/TLS; không dùng Socket.IO làm WebSocket thuần.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F13 ...` / `fix: F13 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP1 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F13

create_issue 'F14' '[F14] Sửa / xóa / thả cảm xúc tin nhắn' 'type:feature,priority:should,KP3,fe,be' 'W07 - Tuần 7' "$TV1_GH" <<'BODY_F14'
## Mô tả
Đồng bộ thao tác sửa, xóa và reaction trong kênh/DM.

**Chức năng:** F14 · **Key points:** KP3 · **Ưu tiên:** SHOULD
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F03, F04, F05.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. 

## Checklist công việc con
- [ ] **FE:** Menu sửa/xóa và reaction; UI nhận sự kiện cập nhật, không tạo tin mới.
- [ ] **BE:** message:edit/message:delete/message:react; validate quyền tác giả/membership, editedAt/deletedAt và reaction idempotent.
- [ ] **Test:** Nhiều client đồng bộ ngay; người không có quyền không sửa/xóa; reaction trùng và nội dung XSS được xử lý.
- [ ] **Docs:** Viết nội dung F14/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Thay đổi hiển thị ở mọi client được phép trong phòng và tồn tại đúng trong lịch sử.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F14 ...` / `fix: F14 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F14

create_issue 'F15' '[F15] Gửi ảnh / file' 'type:feature,priority:should,KP1,KP3,fe,be' 'W07 - Tuần 7' "$TV1_GH" <<'BODY_F15'
## Mô tả
Upload file qua REST, rồi gửi metadata bằng luồng tin nhắn realtime.

**Chức năng:** F15 · **Key points:** KP1, KP3 · **Ưu tiên:** SHOULD
**Phụ trách chính:** Võ Thành Đạt - 52400260 (Frontend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F05, F11.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. 

## Checklist công việc con
- [ ] **FE:** Chọn file, tiến trình/lỗi upload, hiển thị ảnh hoặc link tải.
- [ ] **BE:** POST /api/uploads có auth, size ≤5 MB và kiểm tra file; truy cập file theo quyền phòng; metadata qua message:send (ack)/message:new, không chuyển file lớn qua socket.
- [ ] **Test:** Biên 5 MB/vượt 5 MB, định dạng không được phép, user ngoài phòng không tải được; reconnect không tạo tin đính kèm trùng.
- [ ] **Docs:** Viết nội dung F15/KP1/KP3 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Upload đúng hạn mức; thành viên nhận thông báo file mới realtime; metadata được lưu cùng tin.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F15 ...` / `fix: F15 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP1/KP3 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F15

create_issue 'F16' '[F16] Mở rộng nhiều server' 'type:feature,priority:should,KP4,be,infra' 'W07 - Tuần 7' "$TV2_GH" <<'BODY_F16'
## Mô tả
Chạy hai instance sau Nginx với sticky session và Redis adapter.

**Chức năng:** F16 · **Key points:** KP4 · **Ưu tiên:** SHOULD
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F03, F06, F10, F11, F12.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. 

## Checklist công việc con
- [ ] **FE:** Kiểm tra client không phụ thuộc instance; reconnect và presence nhất quán qua hai server.
- [ ] **BE:** Docker Compose MongoDB 7/Redis 7, hai Node instance; @socket.io/redis-adapter; Nginx TLS tự ký/sticky session; state, rate limit, cap socket và admin actions dùng toàn cụm.
- [ ] **Test:** Chứng minh hai user thực sự vào hai instance khác nhau và vẫn chat; polling transport giữ affinity; stats không đếm trùng, kick/ban áp dụng cả hai instance.
- [ ] **Docs:** Viết nội dung F16/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] docker compose up chạy local; log/bằng chứng định tuyến hai instance; broadcast/presence/admin hoạt động nhất quán qua Redis.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F16 ...` / `fix: F16 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F16

create_issue 'F17' '[F17] Heartbeat ping/pong' 'type:feature,priority:should,KP1,KP4,be' 'W07 - Tuần 7' "$TV2_GH" <<'BODY_F17'
## Mô tả
Phát hiện kết nối chết và dọn presence đúng hạn.

**Chức năng:** F17 · **Key points:** KP1, KP4 · **Ưu tiên:** SHOULD
**Phụ trách chính:** Vòng Thế Phong - 52400225 (Backend)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F02, F06.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. 

## Checklist công việc con
- [ ] **FE:** Hiển thị mất kết nối và reconnect theo F10; không tự thêm sự kiện heartbeat ngoài contract.
- [ ] **BE:** Cấu hình heartbeat Socket.IO/Engine.IO với ngưỡng phát hiện tối đa 25 giây; dọn socket/presence; giải thích khác biệt ping/pong Engine.IO và control frame RFC 6455.
- [ ] **Test:** Mô phỏng blackhole mạng không gửi close; đo thời gian phát hiện từ lần liên lạc cuối; user có tab sống còn lại không thành offline.
- [ ] **Docs:** Viết nội dung F17/KP1/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Kết nối chết được phát hiện trong 25 giây theo điều kiện test đã ghi và không để presence treo.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F17 ...` / `fix: F17 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP1/KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F17

create_issue 'F18' '[F18] Kiểm thử tải 500–1000 kết nối' 'type:feature,priority:should,KP4,be,test' 'W07 - Tuần 7' "$TV3_GH" <<'BODY_F18'
## Mô tả
Đánh giá kết nối đồng thời và hiệu năng bằng Artillery trên máy local.

**Chức năng:** F18 · **Key points:** KP4 · **Ưu tiên:** SHOULD
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F11, F12, F16, F17.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. 

## Checklist công việc con
- [ ] **FE:** Quan sát Admin Dashboard trong khi chạy tải, đối chiếu stats với kết quả test.
- [ ] **BE:** Script Artillery tương thích Socket.IO; seed tài khoản hợp lệ, tối đa 5 socket/user; thu CPU/RAM và latency ở tải 500 rồi 1000 kết nối.
- [ ] **Test:** Chạy ramp-up/steady/recovery; tách workload hợp lệ và spam; ghi connection success, p50/p95, lỗi, cấu hình máy/thời lượng; phát hiện tính trùng stats.
- [ ] **Docs:** Viết nội dung F18/KP4 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Có bằng chứng ≥500 kết nối; 1000 là mức khảo sát, ghi đúng kết quả thực đo, không khẳng định đạt khi chưa test.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F18 ...` / `fix: F18 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP4 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F18

create_issue 'F19' '[F19] Bảng trắng cộng tác' 'type:feature,priority:could,KP2,fe,be' 'W07 - Tuần 7' "$TV3_GH" <<'BODY_F19'
## Mô tả
Nhiều nhân viên cùng vẽ trong một phòng; không mở rộng thành công cụ thiết kế.

**Chức năng:** F19 · **Key points:** KP2 · **Ưu tiên:** COULD
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F03, F11; chỉ bắt đầu khi Must đạt và còn thời gian.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. Bỏ nếu còn Must chưa xong hoặc không đủ thời gian.

## Checklist công việc con
- [ ] **FE:** Canvas, nhận và hiển thị thao tác vẽ từ thành viên trong phòng.
- [ ] **BE:** Chốt sự kiện/payload F19 trong event contract trước code; kiểm tra membership, validate và broadcast thao tác tới đúng phòng.
- [ ] **Test:** Hai client vẽ đồng thời thấy thay đổi; user ngoài phòng không nhận/gửi được; tải nét vẽ không phá rate limit chat.
- [ ] **Docs:** Viết nội dung F19/KP2 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Vẽ đồng bộ trong một phòng; chỉ đưa vào bản bàn giao khi đạt nghiệm thu trước đóng băng code.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F19 ...` / `fix: F19 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP2 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F19

create_issue 'F20' '[F20] Mini game cờ caro 2 người' 'type:feature,priority:could,KP2,fe,be' 'W07 - Tuần 7' "$TV3_GH" <<'BODY_F20'
## Mô tả
Đồng bộ nước đi caro giữa hai người trong phạm vi demo.

**Chức năng:** F20 · **Key points:** KP2 · **Ưu tiên:** COULD
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F03, F11; chỉ bắt đầu khi Must đạt và còn thời gian.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. Bỏ nếu còn Must chưa xong hoặc không đủ thời gian.

## Checklist công việc con
- [ ] **FE:** Bàn cờ, lượt chơi và kết quả cho hai người.
- [ ] **BE:** Chốt sự kiện/payload F20 trong contract; server quản lý bàn cờ, kiểm tra lượt, ô hợp lệ, quyền của hai người và broadcast.
- [ ] **Test:** Nước đi cùng lúc/sai lượt/ô đã đánh bị từ chối; hai client có cùng bàn cờ/kết quả; người thứ ba không điều khiển trận.
- [ ] **Docs:** Viết nội dung F20/KP2 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Hai người chơi nhận nước đi realtime; luật thắng/hòa được ghi rõ, không thêm matchmaking hay bảng xếp hạng.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F20 ...` / `fix: F20 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP2 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F20

create_issue 'F21' '[F21] Browser Notification khi ẩn tab' 'type:feature,priority:could,KP2,fe,be' 'W07 - Tuần 7' "$TV3_GH" <<'BODY_F21'
## Mô tả
Hiện thông báo hệ điều hành cho DM/@mention khi tab không được mở.

**Chức năng:** F21 · **Key points:** KP2 · **Ưu tiên:** COULD
**Phụ trách chính:** Nguyễn Thái An - 52400064 (Lab & Admin)
**Phối hợp:** TV1 phần FE; TV2 phần BE/infra; TV3 Lab/Admin và điều phối test.
**Milestone:** W07 - Tuần 7 · **Phụ thuộc:** F09; chỉ bắt đầu khi Must đạt và còn thời gian.
**Điều kiện triển khai:** ưu tiên Must; chỉ bàn giao nếu đạt nghiệm thu trước 01/12/2026. Bỏ nếu còn Must chưa xong hoặc không đủ thời gian.

## Checklist công việc con
- [ ] **FE:** Xin quyền bằng thao tác người dùng; Notification API và visibilityState; click mở đúng hội thoại.
- [ ] **BE:** Tái sử dụng notification:new của F09; không thêm luồng push cloud hoặc chức năng ngoài phạm vi.
- [ ] **Test:** Quyền granted/denied/default, tab hiện/ẩn và nhiều tab; không tạo nhiều thông báo cho cùng một notification.
- [ ] **Docs:** Viết nội dung F21/KP2 bằng tiếng Anh theo văn phong học thuật; cập nhật README/cách chạy/cách test; lưu ảnh, log và số liệu thực tế cho báo cáo/demo.

## Tiêu chí nghiệm thu
- [ ] Tab ẩn nhận thông báo khi được cấp quyền; từ chối quyền không gây lỗi; ghi rõ thông báo chỉ hoạt động khi app vẫn có kết nối.
- [ ] Mọi event dùng `{ type, payload, ts }`; client event cần xác nhận dùng ack; mã lỗi theo contract: `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`.
- [ ] Test phù hợp đã pass; PR có ít nhất một review chấp thuận của thành viên khác; commit theo `feat: F21 ...` / `fix: F21 ...` / `test: ...` / `docs: ...`.
- [ ] Có bằng chứng nghiệm thu và giải thích KP2 trong báo cáo/video; không thêm chức năng ngoài F01-F21.

## Bằng chứng
PR / kết quả test / ảnh hoặc log / đoạn báo cáo: bổ sung khi thực hiện.
BODY_F21

printf '%s\n' 'Done. Existing Fxx issues are skipped, not updated. Run only one copy of this script at a time.'

