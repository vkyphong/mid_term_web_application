-- Ảnh đại diện tài khoản (file lưu theo user id trong thư mục upload).
ALTER TABLE users ADD COLUMN avatar_media_type VARCHAR(32);
ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMP(6);
