package dev.pulsechat.config;

import java.io.IOException;
import java.util.List;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import dev.pulsechat.auth.AuthService;
import dev.pulsechat.common.*;

public class ApiSecurityFilter extends OncePerRequestFilter {
    private final AuthService auth;
    private final AppProperties properties;
    private final ObjectMapper mapper;
    public ApiSecurityFilter(AuthService auth, AppProperties properties, ObjectMapper mapper) {
        this.auth = auth; this.properties = properties; this.mapper = mapper;
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if ((path.startsWith("/api/") || path.equals("/ws")) && !OriginPolicy.accepts(request, properties)) {
            ApiErrors.write(response, mapper, new ApiException(403, "forbidden", "origin_not_allowed", "Origin not allowed")); return;
        }
        // Auth endpoints use their own credentials/cookie; never let a stale Bearer prevent refresh or logout.
        boolean publicAuth = "POST".equals(request.getMethod()) && List.of("/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/auth/logout").contains(path);
        if (path.startsWith("/api/") && !publicAuth && request.getHeader("Authorization") != null) {
            try {
                var principal = auth.authenticate(request.getHeader("Authorization"));
                SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));
            } catch (ApiException e) { ApiErrors.write(response, mapper, e); return; }
        }
        chain.doFilter(request, response);
    }
}
