-- Thông tin cá nhân hiển thị trong "Thông tin tài khoản" (chỉ chủ tài khoản xem / sửa).
ALTER TABLE users ADD COLUMN gender VARCHAR(16);
ALTER TABLE users ADD COLUMN birth_date DATE;
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
