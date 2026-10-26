package dev.pulsechat.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.stereotype.Controller;
import org.springframework.messaging.handler.annotation.*;
import org.springframework.messaging.simp.*;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.common.*;
import static dev.pulsechat.chat.ChatDtos.*;

@Controller
public class ChatSocketController {
    private final ChatService chat;
    private final SimpMessagingTemplate broker;
    private final ObjectMapper mapper;
    private final dev.pulsechat.realtime.SessionRateLimiter limits;
    public ChatSocketController(ChatService chat, SimpMessagingTemplate broker, ObjectMapper mapper, dev.pulsechat.realtime.SessionRateLimiter limits) {
        this.chat = chat; this.broker = broker; this.mapper = mapper; this.limits=limits;
    }
    @MessageMapping({"/room.join", "/room.leave", "/message.send"})
    public void handle(byte[] body, SessionPrincipal user, SimpMessageHeaderAccessor headers) {
        String correlation = null;
        try {
            JsonNode frame;
            try { frame = mapper.readTree(body); } catch (Exception e) { throw ChatService.field("payload", "Invalid JSON"); }
            correlation = text(frame, "correlationId");
            if (correlation.length() > 128) throw ChatService.field("correlationId", "Correlation ID is too long");
            String type = text(frame, "type"); JsonNode payload = frame.get("payload");
            String expected = switch (headers.getDestination()) {
                case "/app/room.join" -> "room:join";
                case "/app/room.leave" -> "room:leave";
                default -> "message:send";
            };
            if (!expected.equals(type)) throw ChatService.field("type", "Event type does not match destination");
            String room = text(payload, "roomId");
            Object data; Delivery delivery = null;
            if (type.equals("room:join")) data = chat.join(room, user.userId());
            else if (type.equals("room:leave")) { chat.leave(room, user.userId()); data = Map.of("roomId", room); }
            else {
                limits.check(headers.getSessionId(),"messages",10,5000);
                var mentions=new java.util.ArrayList<String>();
                if(payload.has("mentions")) {
                    if(!payload.path("mentions").isArray())throw ChatService.field("mentions","Array required");
                    for(JsonNode mention:payload.path("mentions")) {if(!mention.isTextual())throw ChatService.field("mentions","User IDs required");mentions.add(mention.asText());}
                }
                if(!payload.path("content").isTextual())throw ChatService.field("content","String required");
                if(payload.hasNonNull("uploadId")&&!payload.path("uploadId").isTextual())throw ChatService.field("uploadId","String required");
                delivery = chat.send(room, user.userId(), payload.path("content").asText(), text(payload, "clientMsgId"),payload.path("uploadId").asText(null),mentions);
                data = delivery.message();
            }
            // Service transaction has committed. Ack only this socket, then notify all member sessions.
            ack(user, headers, Map.of("correlationId", correlation, "ok", true, "data", data));
            if (delivery != null && delivery.created()) for (String member : delivery.recipients())
                broker.convertAndSendToUser(member, "/queue/events", new Envelope("message:new", delivery.message()));
        } catch (ApiException e) {
            ack(user, headers, Map.of("correlationId", correlation == null ? "" : correlation, "ok", false, "error", ApiErrors.body(e).get("error")));
        }
    }
    private void ack(SessionPrincipal user, SimpMessageHeaderAccessor incoming, Object payload) {
        var headers = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        headers.setSessionId(incoming.getSessionId()); headers.setLeaveMutable(true);
        broker.convertAndSendToUser(user.userId(), "/queue/acks", new Envelope("ack", payload), headers.getMessageHeaders());
    }
    private static String text(JsonNode node, String key) {
        if (node == null || !node.path(key).isTextual() || node.path(key).asText().isBlank()) throw ChatService.field(key, "A non-empty string is required");
        return node.path(key).asText();
    }
}
