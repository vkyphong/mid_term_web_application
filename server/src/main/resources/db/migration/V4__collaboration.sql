ALTER TABLE users ADD COLUMN last_seen TIMESTAMP(6);
ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP(6);
ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP(6);
-- Fail explicitly on legacy cross-room retry collisions; never silently rewrite message identifiers.
CREATE UNIQUE INDEX uk_messages_sender_retry ON messages(sender_id,client_msg_id);
CREATE TABLE message_receipts (
 message_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL,
 delivered_at TIMESTAMP(6), seen_at TIMESTAMP(6),
 PRIMARY KEY(message_id,user_id),
 FOREIGN KEY(message_id) REFERENCES messages(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE message_reactions (
 message_id VARCHAR(36) NOT NULL, user_id VARCHAR(36) NOT NULL, emoji VARCHAR(32) NOT NULL,
 PRIMARY KEY(message_id,user_id,emoji),
 FOREIGN KEY(message_id) REFERENCES messages(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE notifications (
 id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, type VARCHAR(16) NOT NULL,
 room_id VARCHAR(36), message_id VARCHAR(36), content VARCHAR(2048) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL, read_at TIMESTAMP(6),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(room_id) REFERENCES rooms(id),
 FOREIGN KEY(message_id) REFERENCES messages(id), UNIQUE(user_id,message_id,type)
);
CREATE INDEX idx_notifications_user ON notifications(user_id,created_at,id);
CREATE TABLE uploads (
 id VARCHAR(36) PRIMARY KEY, room_id VARCHAR(36) NOT NULL, owner_id VARCHAR(36) NOT NULL,
 filename VARCHAR(200) NOT NULL, media_type VARCHAR(64) NOT NULL, size_bytes BIGINT NOT NULL,
 message_id VARCHAR(36) UNIQUE, created_at TIMESTAMP(6) NOT NULL,
 FOREIGN KEY(room_id) REFERENCES rooms(id), FOREIGN KEY(owner_id) REFERENCES users(id),
 FOREIGN KEY(message_id) REFERENCES messages(id)
);
