CREATE TABLE rooms (
    id VARCHAR(36) PRIMARY KEY,
    type VARCHAR(16) NOT NULL,
    name VARCHAR(40),
    name_key VARCHAR(160),
    description VARCHAR(200),
    dm_key VARCHAR(73),
    last_message_at TIMESTAMP(6),
    CONSTRAINT uk_rooms_name UNIQUE (name_key),
    CONSTRAINT uk_rooms_dm UNIQUE (dm_key),
    CONSTRAINT ck_rooms_type CHECK (type IN ('channel', 'dm'))
);
CREATE TABLE room_members (
    room_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (room_id, user_id),
    CONSTRAINT fk_members_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_members_user ON room_members(user_id, room_id);
CREATE TABLE messages (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    sender_id VARCHAR(36) NOT NULL,
    client_msg_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_messages_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id),
    CONSTRAINT uk_messages_retry UNIQUE (room_id, sender_id, client_msg_id)
);
CREATE INDEX idx_messages_history ON messages(room_id, created_at, id);
INSERT INTO rooms (id, type, name, name_key) VALUES
 ('00000000-0000-4000-8000-000000000001', 'channel', 'Engineering', 'engineering'),
 ('00000000-0000-4000-8000-000000000002', 'channel', 'HR', 'hr'),
 ('00000000-0000-4000-8000-000000000003', 'channel', 'Sales', 'sales'),
 ('00000000-0000-4000-8000-000000000004', 'channel', 'Marketing', 'marketing');
