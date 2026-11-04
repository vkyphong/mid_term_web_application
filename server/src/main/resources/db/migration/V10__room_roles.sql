-- Phân cấp trong kênh: owner (trưởng nhóm, người tạo), deputy (phó nhóm, tối đa 5), member.
ALTER TABLE room_members ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'member';
ALTER TABLE room_members ADD COLUMN joined_at TIMESTAMP(6);
-- Kênh cũ không lưu người tạo: lấy người gửi tin đầu tiên (nếu còn trong kênh) làm trưởng nhóm.
UPDATE room_members SET role='owner'
WHERE room_id IN (SELECT id FROM rooms WHERE type='channel')
  AND user_id = (SELECT m.sender_id FROM messages m WHERE m.room_id = room_members.room_id ORDER BY m.created_at, m.id LIMIT 1);
