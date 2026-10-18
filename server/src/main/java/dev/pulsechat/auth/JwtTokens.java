package dev.pulsechat.auth;

import java.time.Duration;
import java.time.Instant;
import java.nio.charset.StandardCharsets;
import javax.crypto.spec.SecretKeySpec;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import org.springframework.stereotype.Component;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import dev.pulsechat.config.AppProperties;
import dev.pulsechat.common.ApiException;

@Component
public class JwtTokens {
    private final NimbusJwtEncoder encoder;
    private final NimbusJwtDecoder decoder;
    private final AppProperties properties;
    public JwtTokens(AppProperties properties) {
        this.properties = properties;
        var key = new SecretKeySpec(properties.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
            new JwtTimestampValidator(Duration.ZERO), new JwtIssuerValidator("pulsechat")));
    }
    public String issue(AuthSession session) {
        var now = Instant.now();
        var claims = JwtClaimsSet.builder().issuer("pulsechat").subject(session.getUser().getId())
            .issuedAt(now).expiresAt(now.plusSeconds(properties.accessTtlSeconds()))
            .claim("sid", session.getId()).claim("role", session.getUser().getRole()).build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }
    public SessionPrincipal parse(String token) {
        try {
            var jwt = decoder.decode(token);
            String sid = jwt.getClaimAsString("sid");
            if (jwt.getSubject() == null || sid == null || jwt.getExpiresAt() == null) throw new IllegalArgumentException();
            return new SessionPrincipal(jwt.getSubject(), sid, jwt.getExpiresAt());
        } catch (Exception e) { throw new ApiException(401, "unauthorized", "invalid_token", "Invalid or expired access token"); }
    }
}
