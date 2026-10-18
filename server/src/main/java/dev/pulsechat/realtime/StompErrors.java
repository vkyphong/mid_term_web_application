package dev.pulsechat.realtime;

import org.springframework.messaging.*;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.common.*;

public class StompErrors extends StompSubProtocolErrorHandler {
    private final ObjectMapper mapper;
    public StompErrors(ObjectMapper mapper) { this.mapper = mapper; }
    @Override public Message<byte[]> handleClientMessageProcessingError(Message<byte[]> message, Throwable error) {
        Throwable cause = error;
        while (!(cause instanceof ApiException) && cause.getCause() != null) cause = cause.getCause();
        var api = cause instanceof ApiException e ? e : new ApiException(400, "invalid_payload", "validation", "Invalid STOMP frame");
        var headers = StompHeaderAccessor.create(StompCommand.ERROR); headers.setMessage(api.code);
        headers.setContentType(org.springframework.http.MediaType.APPLICATION_JSON);
        try { return MessageBuilder.createMessage(mapper.writeValueAsBytes(ApiErrors.body(api)), headers.getMessageHeaders()); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
