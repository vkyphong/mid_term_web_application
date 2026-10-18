package dev.pulsechat.auth;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import dev.pulsechat.config.AppProperties;
import static dev.pulsechat.auth.AuthDtos.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService auth;
    private final AppProperties properties;
    public AuthController(AuthService auth, AppProperties properties) { this.auth = auth; this.properties = properties; }
    @PostMapping("/register")
    ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterInput input) { return issued(auth.register(input), 201); }
    @PostMapping("/login")
    ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginInput input) { return issued(auth.login(input), 200); }
    @PostMapping("/refresh")
    ResponseEntity<AuthResponse> refresh(@CookieValue(name = "refreshToken", required = false) String token) { return issued(auth.refresh(token), 200); }
    @PostMapping("/logout")
    ResponseEntity<Void> logout(@CookieValue(name = "refreshToken", required = false) String token) {
        auth.logout(token); return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", 0)).build();
    }
    @GetMapping("/me")
    UserView me(java.security.Principal principal) { return UserView.of(auth.validate((SessionPrincipal) ((org.springframework.security.core.Authentication) principal).getPrincipal())); }
    private ResponseEntity<AuthResponse> issued(IssuedAuth issued, int status) {
        return ResponseEntity.status(status).header(HttpHeaders.SET_COOKIE, cookie(issued.refreshToken(), issued.refreshMaxAge()))
            .cacheControl(CacheControl.noStore()).body(issued.response());
    }
    private String cookie(String value, long ttl) {
        return ResponseCookie.from("refreshToken", value).httpOnly(true).secure(properties.cookieSecure())
            .sameSite("Strict").path("/api/auth").maxAge(ttl).build().toString();
    }
}
