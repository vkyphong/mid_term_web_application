package dev.pulsechat.realtime;

import org.springframework.stereotype.Component;
import org.springframework.messaging.*;
import org.springframework.messaging.support.*;
import org.springframework.messaging.simp.stomp.*;
import dev.pulsechat.auth.*;
import dev.pulsechat.common.ApiException;

@Component
public class StompAuthInterceptor implements ChannelInterceptor {
    private final AuthService auth;
    private final ConnectionRegistry connections;
    private final org.springframework.beans.factory.ObjectProvider<dev.pulsechat.admin.AdminService> admin;
    public StompAuthInterceptor(AuthService auth, ConnectionRegistry connections,org.springframework.beans.factory.ObjectProvider<dev.pulsechat.admin.AdminService> admin) { this.auth = auth; this.connections = connections; this.admin=admin; }
    @Override public Message<?> preSend(Message<?> message, MessageChannel channel) {
        var headers = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (headers == null || headers.getCommand() == null) return message;
        var command = headers.getCommand();
        if (command == StompCommand.DISCONNECT) return message;
        if (command == StompCommand.CONNECT) {
            var principal = auth.authenticate(headers.getFirstNativeHeader("Authorization"));
            connections.authenticate(headers.getSessionId(), principal); headers.setUser(principal); return message;
        }
        if (!(headers.getUser() instanceof SessionPrincipal principal))
            throw new ApiException(401, "unauthorized", "invalid_token", "CONNECT authentication required");
        auth.validate(principal);
        if (command == StompCommand.SEND && !java.util.Set.of("/app/session/ping", "/app/room.join", "/app/room.leave", "/app/message.send", "/app/typing.start", "/app/typing.stop", "/app/message.delivered", "/app/message.seen", "/app/message.edit", "/app/message.delete", "/app/message.react", "/app/admin.kick", "/app/admin.broadcast").contains(headers.getDestination()))
            throw new ApiException(403, "forbidden", null, "Destination not allowed");
        if (command == StompCommand.SUBSCRIBE && !java.util.Set.of("/user/queue/session", "/user/queue/acks", "/user/queue/events", "/user/queue/presence", "/user/queue/typing", "/user/queue/notifications", "/user/queue/admin").contains(headers.getDestination()))
            throw new ApiException(403, "forbidden", null, "Subscription not allowed");
        if("/user/queue/admin".equals(headers.getDestination()) || (headers.getDestination()!=null&&headers.getDestination().startsWith("/app/admin."))) admin.getObject().requireAdmin(principal.userId());
        if (command != StompCommand.SEND && command != StompCommand.SUBSCRIBE && command != StompCommand.UNSUBSCRIBE)
            throw new ApiException(403, "forbidden", null, "Command not allowed");
        return message;
    }
}
