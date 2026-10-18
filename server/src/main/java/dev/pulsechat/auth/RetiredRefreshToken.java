package dev.pulsechat.auth;
import jakarta.persistence.*;
@Entity
@Table(name = "retired_refresh_tokens")
public class RetiredRefreshToken {
    @Id @Column(name = "token_hash", length = 64) private String tokenHash;
    @Column(name = "session_id", nullable = false, length = 36) private String sessionId;
    protected RetiredRefreshToken() {}
    public RetiredRefreshToken(String tokenHash, String sessionId) { this.tokenHash = tokenHash; this.sessionId = sessionId; }
    public String getSessionId() { return sessionId; }
}
