-- Ảnh nhóm (file lưu theo room id trong thư mục upload) và biệt danh trong tin nhắn riêng.
ALTER TABLE rooms ADD COLUMN avatar_media_type VARCHAR(32);
ALTER TABLE rooms ADD COLUMN avatar_updated_at TIMESTAMP(6);
-- Biệt danh do user_id đặt cho người còn lại của DM room_id; chỉ người đặt nhìn thấy.
CREATE TABLE room_nicknames (
    room_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    nickname VARCHAR(40) NOT NULL,
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT fk_room_nicknames_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_room_nicknames_user FOREIGN KEY (user_id) REFERENCES users(id)
);
