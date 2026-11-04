-- Trả lời tin nhắn, ghim tin nhắn, xoá tin chỉ ở phía mình.
ALTER TABLE messages ADD COLUMN reply_to_id VARCHAR(36);
ALTER TABLE messages ADD COLUMN pinned_at TIMESTAMP(6);
ALTER TABLE messages ADD COLUMN pinned_by VARCHAR(36);
CREATE TABLE message_hidden (
    message_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    hidden_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (message_id, user_id),
    CONSTRAINT fk_message_hidden_message FOREIGN KEY (message_id) REFERENCES messages(id),
    CONSTRAINT fk_message_hidden_user FOREIGN KEY (user_id) REFERENCES users(id)
);
