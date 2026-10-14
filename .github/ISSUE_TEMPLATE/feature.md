---
name: "Feature thuộc F01-F21"
about: "Đặc tả chức năng đã chốt và tiêu chí nghiệm thu."
title: "[Fxx] Tên chức năng"
labels: ["type:feature"]
assignees: ""
---

## Truy vết và phân công
- Fxx (F01-F21):
- KP (KP1/KP2/KP3/KP4):
- Ưu tiên (priority:must/priority:should/priority:could):
- Phụ trách (GitHub login + TV1/TV2/TV3):
- Milestone (Wxx - Tuần x):
- Phụ thuộc (issue/Fxx):

## Mô tả
Nêu nhu cầu, hành vi và giới hạn của chức năng trong PulseChat nội bộ công ty.

## Checklist công việc con
- [ ] FE: giao diện/state/client event cần thực hiện.
- [ ] BE: API/model/socket/authorization/validation cần thực hiện.
- [ ] Test: trường hợp bình thường, lỗi và tiêu chí nghiệm thu; nêu công cụ/cách chạy.
- [ ] Docs: README, cách chạy/test, bằng chứng demo; nội dung báo cáo viết tiếng Anh.

## Tiêu chí nghiệm thu
- [ ] Hành vi quan sát được và số đo (nếu có):
- [ ] Event `{ type, payload, ts }`; ack khi cần; mã lỗi đúng contract.
- [ ] Ít nhất một KPx có bằng chứng.
- [ ] Test đã pass và PR có một review chấp thuận từ thành viên khác.

## Phạm vi
Chỉ triển khai F01-F21; ngoài phạm vi: thoại/video, E2EE, native mobile, OAuth Google/Facebook, cloud.
Nếu đổi phạm vi: thêm 1 bỏ 1 với khối lượng tương đương, cả nhóm duyệt và ghi nhận; bảo toàn Must/KP1-KP4.

## Bằng chứng hoàn thành
PR, ảnh/log, kết quả test và vị trí trong báo cáo/video:

