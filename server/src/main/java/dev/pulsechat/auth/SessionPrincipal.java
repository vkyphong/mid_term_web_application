package dev.pulsechat.auth;
import java.security.Principal;
import java.time.Instant;
public record SessionPrincipal(String userId, String sessionId, Instant expiresAt) implements Principal {
    @Override public String getName() { return userId; }
}
