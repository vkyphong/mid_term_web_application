package dev.pulsechat.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.context.ApplicationEventPublisher;
import dev.pulsechat.config.AppProperties;
import dev.pulsechat.common.ApiException;
import static dev.pulsechat.auth.AuthDtos.*;

@Service
public class AuthService {
    private final UserRepository users;
    private final AuthSessionRepository sessions;
    private final RetiredRefreshTokenRepository retired;
    private final PasswordEncoder passwords;
    private final JwtTokens jwt;
    private final AppProperties properties;
    private final ApplicationEventPublisher events;
    private final String dummyHash;
    public AuthService(UserRepository users, AuthSessionRepository sessions, PasswordEncoder passwords,
            JwtTokens jwt, AppProperties properties, ApplicationEventPublisher events, RetiredRefreshTokenRepository retired) {
        this.users = users; this.sessions = sessions; this.passwords = passwords; this.jwt = jwt;
        this.properties = properties; this.events = events; this.retired = retired; dummyHash = passwords.encode("dummy-password-012345");
    }
    @Transactional
    public IssuedAuth register(RegisterInput input) {
        var email = normalizeEmail(input.email());
        String[] parts = email.split("@", -1);
        if (parts.length != 2 || parts[0].isBlank() || !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) field("email", "Email không hợp lệ");
        if (properties.allowedEmailDomains().stream().noneMatch(d -> d.trim().equalsIgnoreCase(parts[1])))
            throw new ApiException(403, "forbidden", "domain_not_allowed", "Email domain is not allowed");
        String name = input.displayName().trim();
        if (name.length() < 2 || name.length() > 50) field("displayName", "Tên hiển thị cần 2–50 ký tự");
        String password = input.password();
        if (password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72
                || !password.matches("(?s).*[A-Za-z].*") || !password.matches("(?s).*\\d.*"))
            field("password", "Mật khẩu cần ít nhất 8 ký tự, chữ và số, tối đa 72 byte UTF-8");
        if (users.findByEmail(email).isPresent()) throw new ApiException(409, "invalid_payload", "email_taken", "Email already registered");
        return newSession(users.saveAndFlush(new User(email, name, passwords.encode(password))));
    }
    @Transactional
    public IssuedAuth login(LoginInput input) {
        var user = users.findByEmail(normalizeEmail(input.email())).orElse(null);
        boolean matches = input.password().getBytes(StandardCharsets.UTF_8).length <= 72
            && passwords.matches(input.password(), user == null ? dummyHash : user.getPasswordHash());
        if (user == null || !matches) throw new ApiException(401, "unauthorized", "invalid_credentials", "Invalid credentials");
        checkEnabled(user);
        return newSession(user);
    }
    private IssuedAuth newSession(User user) {
        String raw = randomToken();
        var session = sessions.save(new AuthSession(user, hash(raw), Instant.now().plusSeconds(properties.refreshTtlSeconds())));
        return response(session, raw);
    }
    @Transactional
    public IssuedAuth refresh(String raw) {
        var session = sessions.lockByHash(hash(raw == null ? "" : raw)).filter(AuthSession::isActive)
            .orElseThrow(() -> new ApiException(401, "unauthorized", "refresh_invalid", "Invalid refresh token"));
        checkEnabled(session.getUser());
        retired.save(new RetiredRefreshToken(session.getRefreshHash(), session.getId()));
        String next = randomToken(); session.rotate(hash(next));
        return response(session, next);
    }
    @Transactional
    public void logout(String raw) {
        if (raw == null) return;
        String hashed = hash(raw);
        // Logout may carry the pre-rotation cookie when a refresh response is still in flight.
        var found = sessions.lockByHash(hashed).or(() -> retired.findById(hashed).flatMap(t -> sessions.lockById(t.getSessionId())));
        found.ifPresent(session -> {
            session.revoke(); events.publishEvent(new SessionRevoked(session.getId()));
        });
    }
    @Transactional(readOnly = true)
    public User validate(SessionPrincipal principal) {
        if (!principal.expiresAt().isAfter(Instant.now())) throw new ApiException(401, "unauthorized", "invalid_token", "Expired token");
        var session = sessions.findById(principal.sessionId()).filter(AuthSession::isActive)
            .filter(s -> s.getUser().getId().equals(principal.userId()))
            .orElseThrow(() -> new ApiException(401, "unauthorized", "invalid_token", "Session revoked"));
        checkEnabled(session.getUser()); return session.getUser();
    }
    public SessionPrincipal authenticate(String bearer) {
        if (bearer == null || !bearer.startsWith("Bearer ")) throw new ApiException(401, "unauthorized", "invalid_token", "Bearer token required");
        var principal = jwt.parse(bearer.substring(7)); validate(principal); return principal;
    }
    private IssuedAuth response(AuthSession session, String raw) {
        return new IssuedAuth(new AuthResponse(jwt.issue(session), properties.accessTtlSeconds(), UserView.of(session.getUser())), raw,
            Math.max(0, session.getExpiresAt().getEpochSecond() - Instant.now().getEpochSecond()));
    }
    private static void checkEnabled(User user) {
        if (!user.isEnabled()) throw new ApiException(403, "forbidden", "banned", "Account banned");
    }
    private static void field(String field, String message) {
        throw new ApiException(400, "invalid_payload", "validation", "Invalid request", List.of(new ApiException.FieldIssue(field, message)));
    }
    private static String normalizeEmail(String value) { return value.trim().toLowerCase(Locale.ROOT); }
    private static String randomToken() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String hash(String raw) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
