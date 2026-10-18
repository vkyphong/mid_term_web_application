package dev.pulsechat.config;

import java.net.URI;
import jakarta.servlet.http.HttpServletRequest;

public final class OriginPolicy {
    private OriginPolicy() {}
    public static boolean accepts(HttpServletRequest request, AppProperties properties) {
        String origin = request.getHeader("Origin");
        if (origin == null) return true; // CLI/non-browser requests; browsers send Origin for cross-origin POST.
        if (properties.allowedOrigins() != null && properties.allowedOrigins().contains(origin)) return true;
        try {
            URI uri = URI.create(origin);
            int port = uri.getPort() == -1 ? ("https".equals(uri.getScheme()) ? 443 : 80) : uri.getPort();
            return uri.getUserInfo() == null && (uri.getPath() == null || uri.getPath().isEmpty())
                && uri.getQuery() == null && uri.getFragment() == null
                && request.getScheme().equals(uri.getScheme()) && request.getServerName().equalsIgnoreCase(uri.getHost())
                && request.getServerPort() == port;
        } catch (Exception e) { return false; }
    }
}
