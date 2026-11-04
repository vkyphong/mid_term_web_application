-- Hồ sơ công khai: người khác xem được giới tính / ngày sinh / điện thoại. Mặc định riêng tư.
ALTER TABLE users ADD COLUMN profile_public BOOLEAN NOT NULL DEFAULT FALSE;
-- Khoá bình chọn (người tạo, trưởng nhóm, phó nhóm).
ALTER TABLE polls ADD COLUMN closed_at TIMESTAMP(6);
ALTER TABLE polls ADD COLUMN closed_by VARCHAR(36);
-- Dòng hoạt động trong khung chat ("X đã bình chọn ..."): tin hệ thống, không receipts, không thông báo.
ALTER TABLE messages ADD COLUMN activity VARCHAR(16);
ALTER TABLE messages ADD COLUMN activity_poll_id VARCHAR(36);
