package dev.pulsechat.auth;

import jakarta.validation.constraints.*;

public final class AuthDtos {
    private AuthDtos() {}
    public record LoginInput(@NotBlank @Size(max = 254) String email, @NotBlank @Size(max = 1024) String password) {}
    public record RegisterInput(@NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 100) String displayName, @NotBlank @Size(max = 1024) String password) {}
    public record UserView(String id, String email, String displayName, String role) {
        public static UserView of(User user) { return new UserView(user.getId(), user.getEmail(), user.getDisplayName(), user.getRole()); }
    }
    public record AuthResponse(String accessToken, long expiresIn, UserView user) {}
    public record IssuedAuth(AuthResponse response, String refreshToken, long refreshMaxAge) {}
    public record SessionRevoked(String sessionId) {}
}
