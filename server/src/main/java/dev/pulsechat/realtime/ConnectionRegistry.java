package dev.pulsechat.realtime;

import java.io.IOException;
import java.time.Instant;
import java.util.concurrent.*;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.transaction.event.TransactionalEventListener;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.auth.AuthDtos.SessionRevoked;
import dev.pulsechat.common.ApiException;

@Component
public class ConnectionRegistry {
    private static class Connection {
        final WebSocketSession socket;
        volatile SessionPrincipal principal;
        volatile ScheduledFuture<?> deadline;
        Connection(WebSocketSession socket) { this.socket = socket; }
    }
    private final ConcurrentMap<String, Connection> connections = new ConcurrentHashMap<>();
    private final ThreadPoolTaskScheduler scheduler;
    public ConnectionRegistry(ThreadPoolTaskScheduler realtimeScheduler) { scheduler = realtimeScheduler; }
    public void opened(WebSocketSession socket) {
        var connection = new Connection(socket); connections.put(socket.getId(), connection);
        connection.deadline = scheduler.schedule(() -> close(socket.getId(), "CONNECT timeout"), Instant.now().plusSeconds(5));
    }
    public synchronized void authenticate(String socketId, SessionPrincipal principal) {
        var connection = connections.get(socketId);
        if (connection == null || connection.principal != null) throw new ApiException(401, "unauthorized", "invalid_token", "Invalid connection");
        long count = connections.values().stream().filter(c -> c.principal != null && c.principal.userId().equals(principal.userId())).count();
        if (count >= 5) throw new ApiException(429, "rate_limited", "connection_limit", "Maximum 5 connections per user");
        connection.principal = principal;
        if (connection.deadline != null) connection.deadline.cancel(false);
        connection.deadline = scheduler.schedule(() -> close(socketId, "Access token expired"), principal.expiresAt());
    }
    public synchronized void removed(String id) {
        var connection = connections.remove(id);
        if (connection != null && connection.deadline != null) connection.deadline.cancel(false);
    }
    private void close(String id, String reason) {
        var connection = connections.get(id);
        if (connection == null) return;
        try { connection.socket.close(new CloseStatus(1008, reason)); } catch (IOException ignored) { }
        finally { removed(id); }
    }
    @TransactionalEventListener
    public void revoked(SessionRevoked event) {
        connections.forEach((id, c) -> { if (c.principal != null && c.principal.sessionId().equals(event.sessionId())) close(id, "Session revoked"); });
    }
}
