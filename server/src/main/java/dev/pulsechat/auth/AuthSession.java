package dev.pulsechat.auth;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "auth_sessions")
public class AuthSession {
    @Id @Column(length = 36) private String id;
    @ManyToOne(fetch = FetchType.EAGER, optional = false) @JoinColumn(name = "user_id") private User user;
    @Column(name = "refresh_hash", nullable = false, unique = true, length = 64) private String refreshHash;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(nullable = false) private boolean revoked;
    protected AuthSession() {}
    public AuthSession(User user, String hash, Instant expiresAt) {
        this.id = UUID.randomUUID().toString(); this.user = user; this.refreshHash = hash; this.expiresAt = expiresAt;
    }
    public String getId() { return id; }
    public String getRefreshHash() { return refreshHash; }
    public User getUser() { return user; }
    public Instant getExpiresAt() { return expiresAt; }
    public boolean isActive() { return !revoked && expiresAt.isAfter(Instant.now()); }
    public void rotate(String hash) { refreshHash = hash; }
    public void revoke() { revoked = true; }
}
