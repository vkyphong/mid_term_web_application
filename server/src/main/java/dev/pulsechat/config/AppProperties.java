package dev.pulsechat.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

@Validated
@ConfigurationProperties("app")
public record AppProperties(@Size(min = 32) String jwtSecret,
        @Min(5) long accessTtlSeconds, @Min(60) long refreshTtlSeconds,
        @NotEmpty List<String> allowedEmailDomains, List<String> allowedOrigins, boolean cookieSecure) {}
