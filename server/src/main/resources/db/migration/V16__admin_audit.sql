-- Nhật ký quản trị: mỗi thao tác của admin (kick, ban, cấp quyền, broadcast, quản lý nhóm).
-- target_label lưu tên / email tại thời điểm thao tác, để đọc lại đúng kể cả khi sau này đổi tên.
CREATE TABLE admin_audit (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    actor_id VARCHAR(36) NOT NULL,
    action VARCHAR(32) NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    target_id VARCHAR(36),
    target_label VARCHAR(254),
    detail VARCHAR(500),
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_admin_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at);
