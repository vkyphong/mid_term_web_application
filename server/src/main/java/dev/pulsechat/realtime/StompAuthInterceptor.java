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
    public StompAuthInterceptor(AuthService auth, ConnectionRegistry connections) { this.auth = auth; this.connections = connections; }
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
        if (command == StompCommand.SEND && !java.util.Set.of("/app/session/ping", "/app/room.join", "/app/room.leave", "/app/message.send").contains(headers.getDestination()))
            throw new ApiException(403, "forbidden", null, "Destination not allowed");
        if (command == StompCommand.SUBSCRIBE && !java.util.Set.of("/user/queue/session", "/user/queue/acks", "/user/queue/events").contains(headers.getDestination()))
            throw new ApiException(403, "forbidden", null, "Subscription not allowed");
        if (command != StompCommand.SEND && command != StompCommand.SUBSCRIBE && command != StompCommand.UNSUBSCRIBE)
            throw new ApiException(403, "forbidden", null, "Command not allowed");
        return message;
    }
}
