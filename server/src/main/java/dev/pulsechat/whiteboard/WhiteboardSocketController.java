package dev.pulsechat.whiteboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatDtos.Envelope;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.*;
import dev.pulsechat.realtime.SessionRateLimiter;
import java.time.Instant;
import java.util.Map;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.*;
import org.springframework.stereotype.Controller;

@Controller
public class WhiteboardSocketController {
    private final WhiteboardService boards;
    private final SessionRateLimiter limits;
    private final ObjectMapper mapper;
    private final SimpMessagingTemplate broker;
    public WhiteboardSocketController(WhiteboardService boards, SessionRateLimiter limits, ObjectMapper mapper, SimpMessagingTemplate broker) {
        this.boards = boards; this.limits = limits; this.mapper = mapper; this.broker = broker;
    }
    @MessageMapping({"/whiteboard.segment", "/whiteboard.clear"})
    public void handle(byte[] body, SessionPrincipal user, SimpMessageHeaderAccessor headers) {
        String correlation = "";
        try {
            JsonNode frame;
            try { frame = mapper.readTree(body); } catch (Exception e) { throw ChatService.field("payload", "Invalid JSON"); }
            if (frame == null || !frame.isObject()) throw ChatService.field("payload", "An envelope is required");
            if (!frame.path("correlationId").isTextual() || frame.path("correlationId").asText().isBlank() || frame.path("correlationId").asText().length() > 128)
                throw ChatService.field("correlationId", "Use 1–128 characters");
            correlation = frame.path("correlationId").asText();
            limits.check(headers.getSessionId(), "whiteboard", 8, 1000);
            if (body.length > 4096) throw ChatService.field("payload", "Maximum 4096-byte whiteboard envelope");
            try { Instant.parse(frame.path("ts").asText()); } catch (Exception e) { throw ChatService.field("ts", "An ISO timestamp is required"); }
            String type = headers.getDestination().equals("/app/whiteboard.segment") ? "whiteboard:segment" : "whiteboard:clear";
            if (!type.equals(frame.path("type").asText()) || !frame.path("payload").isObject()) throw ChatService.field("type", "Type must match destination and payload must be an object");
            Object data = type.equals("whiteboard:segment") ? boards.segment(user.userId(), frame.path("payload")) : boards.clear(user.userId(), frame.path("payload"));
            ack(user, headers, Map.of("correlationId", correlation, "ok", true, "data", data));
        } catch (ApiException e) {
            ack(user, headers, Map.of("correlationId", correlation, "ok", false, "error", ApiErrors.body(e).get("error")));
        }
    }
    private void ack(SessionPrincipal user, SimpMessageHeaderAccessor incoming, Object data) {
        var headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(incoming.getSessionId()); headers.setLeaveMutable(true);
        broker.convertAndSendToUser(user.userId(), "/queue/acks", new Envelope("ack", data), headers.getMessageHeaders());
    }
}
