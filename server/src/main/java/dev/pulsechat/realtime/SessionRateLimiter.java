package dev.pulsechat.realtime;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import dev.pulsechat.common.ApiException;
import org.springframework.stereotype.Component;
import org.springframework.context.event.EventListener;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
public class SessionRateLimiter {
    private final Map<String, ArrayDeque<Long>> windows = new ConcurrentHashMap<>();
    public void check(String session, String operation, int maximum, long millis) {
        var times = windows.computeIfAbsent(session + ":" + operation, k -> new ArrayDeque<>());
        synchronized (times) {
            long now = System.nanoTime();
            while (!times.isEmpty() && now - times.getFirst() >= millis * 1_000_000) times.removeFirst();
            if (times.size() >= maximum) throw new ApiException(429, "rate_limited", "send_limit", "Try again after the rate-limit window");
            times.addLast(now);
        }
    }
    @EventListener public void disconnected(SessionDisconnectEvent event) {
        forget(event.getSessionId());
    }
    public void forget(String session){windows.keySet().removeIf(key->key.startsWith(session+":"));}
}
