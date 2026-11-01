CREATE TABLE whiteboards (
    room_id VARCHAR(36) PRIMARY KEY,
    generation BIGINT NOT NULL DEFAULT 0,
    revision BIGINT NOT NULL DEFAULT 0,
    last_clear_id VARCHAR(36),
    last_clear_author VARCHAR(36),
    last_clear_revision BIGINT,
    CONSTRAINT fk_whiteboard_room FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE whiteboard_segments (
    room_id VARCHAR(36) NOT NULL,
    author_id VARCHAR(36) NOT NULL,
    operation_id VARCHAR(36) NOT NULL,
    generation BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    color VARCHAR(7) NOT NULL,
    width INT NOT NULL,
    points_json TEXT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (room_id, author_id, operation_id),
    CONSTRAINT uk_whiteboard_revision UNIQUE (room_id, revision),
    CONSTRAINT fk_segment_board FOREIGN KEY (room_id) REFERENCES whiteboards(room_id),
    CONSTRAINT fk_segment_author FOREIGN KEY (author_id) REFERENCES users(id)
);
