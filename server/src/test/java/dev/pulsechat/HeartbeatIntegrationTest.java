package dev.pulsechat;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.auth.AuthDtos;
import dev.pulsechat.auth.AuthService;
import dev.pulsechat.realtime.ConnectionRegistry;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

/** F17: kết nối im lặng bị đóng sau 3 chu kỳ heartbeat (test dùng 1 s, chạy thật 5 s). */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:h2:mem:heartbeat;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "app.heartbeat-ms=1000",
    // Profile test để token 5 s; kéo dài để kết nối chỉ bị đóng vì heartbeat, không vì hết hạn token.
    "app.access-ttl-seconds=300",
})
@ActiveProfiles("test")
class HeartbeatIntegrationTest {
    private static final long HEARTBEAT_MS = 1000;
    private static final long LIMIT_MS = HEARTBEAT_MS * 3;

    @Autowired AuthService auth;
    @Autowired ConnectionRegistry connections;
    @Autowired ObjectMapper mapper;
    @LocalServerPort int port;

    private AuthDtos.AuthResponse register(String name) {
        return auth.register(new AuthDtos.RegisterInput("hb-" + UUID.randomUUID() + "@DQGM.dev", name, "Password123")).response();
    }

    /** Client STOMP thô: chỉ gửi những gì test bảo, không tự gửi heartbeat hay close. */
    private class Socket implements WebSocket.Listener, AutoCloseable {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        final StringBuilder buffer = new StringBuilder();
        final WebSocket ws;
        volatile long lastSentAt;
        Socket() {
            ws = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", "http://localhost:" + port).subprotocols("v12.stomp")
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), this).join();
        }
        void send(String text) { ws.sendText(text, true).join(); lastSentAt = System.currentTimeMillis(); }
        void connect(String token, String heartbeat) throws Exception {
            send("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:" + heartbeat + "\nAuthorization:Bearer " + token + "\n\n\u0000");
            String connected = frames.poll(4, TimeUnit.SECONDS);
            assertThat(connected).startsWith("CONNECTED");
        }
        void heartbeat() { send("\n"); }
        @Override public void onOpen(WebSocket w) { w.request(1); }
        @Override public CompletionStage<?> onText(WebSocket w, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) { String value = buffer.toString(); buffer.setLength(0); if (!value.isBlank()) frames.add(value); }
            w.request(1); return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket w, int code, String reason) { closed.complete(code); return null; }
        @Override public void onError(WebSocket w, Throwable error) { closed.completeExceptionally(error); }
        @Override public void close() { ws.abort(); }
    }

    private long authenticated() { return connections.authenticatedCount(); }

    /** Đợi tới khi số kết nối đã xác thực giảm xuống `target`; trả về số ms kể từ `since`. */
    private long awaitConnections(long target, long since, long timeoutMs) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        while (authenticated() > target && System.currentTimeMillis() < end) Thread.sleep(50);
        assertThat(authenticated()).isEqualTo(target);
        return System.currentTimeMillis() - since;
    }

    private JsonNode presenceFor(Socket observer, String userId, long timeoutMs) throws Exception {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            String frame = observer.frames.poll(100, TimeUnit.MILLISECONDS);
            if (frame == null || !frame.startsWith("MESSAGE")) continue;
            var json = mapper.readTree(frame.substring(frame.indexOf("\n\n") + 2).replace("\u0000", ""));
            if ("presence:update".equals(json.path("type").asText()) && userId.equals(json.at("/payload/userId").asText())) return json;
        }
        return null;
    }

    @Test
    void silentConnectionsAreDetectedWithinThreeHeartbeatsAndPresenceIsCleanedUp() throws Exception {
        var alice = register("Alice Heartbeat");
        var bob = register("Bob Observer");
        var beats = Executors.newSingleThreadScheduledExecutor();
        try (var observer = new Socket(); var aliceLive = new Socket(); var aliceDead = new Socket()) {
            // Người quan sát không đăng ký heartbeat (0,0) nên không bị đóng; chỉ nghe presence.
            observer.connect(bob.accessToken(), "0,0");
            observer.send("SUBSCRIBE\nid:p\ndestination:/user/queue/presence\n\n\u0000");
            aliceLive.connect(alice.accessToken(), HEARTBEAT_MS + "," + HEARTBEAT_MS);
            aliceDead.connect(alice.accessToken(), HEARTBEAT_MS + "," + HEARTBEAT_MS);
            long baseline = authenticated();
            // Tab sống gửi nhịp đều; tab chết im lặng từ đây và KHÔNG gửi close (mô phỏng blackhole).
            var live = beats.scheduleAtFixedRate(aliceLive::heartbeat, 0, HEARTBEAT_MS / 3, TimeUnit.MILLISECONDS);
            observer.frames.clear();

            long detected = awaitConnections(baseline - 1, aliceDead.lastSentAt, LIMIT_MS + 3000);
            assertThat(detected).isBetween(LIMIT_MS, LIMIT_MS + 1500);
            // Còn tab sống → Alice vẫn online, không có presence offline nào cho Alice.
            assertThat(connections.onlineUsers()).contains(alice.user().id());
            assertThat(presenceFor(observer, alice.user().id(), 500)).isNull();
            assertThat(aliceLive.closed).isNotDone();

            // Tab cuối cùng cũng im lặng → Alice offline đúng hạn, người khác nhận presence:update ngay.
            live.cancel(false);
            Thread.sleep(HEARTBEAT_MS / 3);
            long lastContact = aliceLive.lastSentAt;
            var offline = presenceFor(observer, alice.user().id(), LIMIT_MS + 3000);
            long offlineAfter = System.currentTimeMillis() - lastContact;
            assertThat(offline).isNotNull();
            assertThat(offline.at("/payload/online").asBoolean()).isFalse();
            assertThat(offline.at("/payload/lastSeen").isNull()).isFalse();
            assertThat(offlineAfter).isBetween(LIMIT_MS, LIMIT_MS + 1500);
            assertThat(connections.onlineUsers()).doesNotContain(alice.user().id());
        } finally {
            beats.shutdownNow();
        }
    }

    @Test
    void clientsWithoutHeartbeatAreNotClosedBySilence() throws Exception {
        var carol = register("Carol NoHeartbeat");
        try (var socket = new Socket()) {
            socket.connect(carol.accessToken(), "0,0");
            Thread.sleep(LIMIT_MS + 1500);
            assertThat(socket.closed).isNotDone();
            assertThat(connections.onlineUsers()).contains(carol.user().id());
        }
    }
}
