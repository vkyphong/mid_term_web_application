-- Bình chọn: mỗi bình chọn gắn với một tin nhắn trong phòng.
CREATE TABLE polls (
    id VARCHAR(36) PRIMARY KEY,
    room_id VARCHAR(36) NOT NULL,
    message_id VARCHAR(36) NOT NULL,
    question VARCHAR(200) NOT NULL,
    multiple BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(36) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT uk_polls_message UNIQUE (message_id),
    CONSTRAINT fk_polls_room FOREIGN KEY (room_id) REFERENCES rooms(id),
    CONSTRAINT fk_polls_message FOREIGN KEY (message_id) REFERENCES messages(id),
    CONSTRAINT fk_polls_user FOREIGN KEY (created_by) REFERENCES users(id)
);
CREATE TABLE poll_options (
    id VARCHAR(36) PRIMARY KEY,
    poll_id VARCHAR(36) NOT NULL,
    sort_order INT NOT NULL,
    label VARCHAR(100) NOT NULL,
    CONSTRAINT fk_poll_options_poll FOREIGN KEY (poll_id) REFERENCES polls(id)
);
CREATE TABLE poll_votes (
    option_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    poll_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (option_id, user_id),
    CONSTRAINT fk_poll_votes_option FOREIGN KEY (option_id) REFERENCES poll_options(id),
    CONSTRAINT fk_poll_votes_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_poll_votes_poll FOREIGN KEY (poll_id) REFERENCES polls(id)
);
CREATE INDEX idx_poll_votes_poll ON poll_votes(poll_id, user_id);
