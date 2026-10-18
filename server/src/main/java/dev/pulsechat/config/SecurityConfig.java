package dev.pulsechat.config;

import java.util.List;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.*;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.*;
import dev.pulsechat.auth.AuthService;
import dev.pulsechat.common.*;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean SecurityFilterChain security(HttpSecurity http, AuthService auth, AppProperties properties, ObjectMapper mapper) throws Exception {
        return http
            // Stateless Bearer APIs. Cookie-authenticated POST endpoints have Strict cookies and an Origin guard.
            .csrf(c -> c.disable()).cors(c -> {})
            .sessionManagement(c -> c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable())
            .authorizeHttpRequests(c -> c
                .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout").permitAll()
                .requestMatchers("/api/**").authenticated().anyRequest().permitAll())
            .exceptionHandling(c -> c
                .authenticationEntryPoint((req, res, e) -> ApiErrors.write(res, mapper, new ApiException(401, "unauthorized", "invalid_token", "Authentication required")))
                .accessDeniedHandler((req, res, e) -> ApiErrors.write(res, mapper, new ApiException(403, "forbidden", null, "Access denied"))))
            .addFilterBefore(new ApiSecurityFilter(auth, properties, mapper), UsernamePasswordAuthenticationFilter.class)
            .build();
    }
    @Bean CorsConfigurationSource cors(AppProperties properties) {
        var source = new UrlBasedCorsConfigurationSource();
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(properties.allowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Content-Type", "Authorization"));
        configuration.setAllowCredentials(true);
        source.registerCorsConfiguration("/api/**", configuration); return source;
    }
}
