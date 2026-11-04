-- Phê duyệt thành viên mới: khi bật, thành viên thường thêm người thì tạo yêu cầu chờ trưởng / phó nhóm duyệt.
ALTER TABLE rooms ADD COLUMN require_approval BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE member_requests (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    requested_by VARCHAR(36) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_member_requests UNIQUE (room_id, user_id),
    CONSTRAINT fk_member_requests_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_member_requests_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_member_requests_by FOREIGN KEY (requested_by) REFERENCES users(id)
);
