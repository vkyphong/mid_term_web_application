CREATE TABLE retired_refresh_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    CONSTRAINT fk_retired_session FOREIGN KEY (session_id) REFERENCES auth_sessions(id)
);
CREATE INDEX idx_retired_session ON retired_refresh_tokens(session_id);
