package dev.pulsechat.realtime;

import java.security.Principal;
import java.time.Instant;
import java.util.Map;
import org.springframework.stereotype.Controller;
import org.springframework.messaging.handler.annotation.*;
import org.springframework.messaging.simp.annotation.SendToUser;

@Controller
public class SessionProbeController {
    public record Probe(String type, Map<String, Object> payload, String ts) {}
    @MessageMapping("/session/ping")
    @SendToUser(value = "/queue/session", broadcast = false)
    public Probe ping(Principal principal) {
        return new Probe("session:pong", Map.of("userId", principal.getName()), Instant.now().toString());
    }
}
