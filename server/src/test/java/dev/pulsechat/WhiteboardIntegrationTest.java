package dev.pulsechat;

import com.fasterxml.jackson.databind.*;
import dev.pulsechat.auth.*;
import dev.pulsechat.chat.*;
import dev.pulsechat.common.ApiException;
import dev.pulsechat.whiteboard.WhiteboardService;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.access-ttl-seconds=900")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WhiteboardIntegrationTest {
    @Autowired WhiteboardService boards;
    @Autowired ChatService chat;
    @Autowired AuthService auth;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate db;
    @Autowired MockMvc mvc;
    @LocalServerPort int port;
    record Account(String id, String token) {}
    Account a, b, outsider;
    String room;
    @BeforeAll void accounts() { a = account(); b = account(); outsider = account(); }
    @BeforeEach void channel() { room = chat.createRoom(a.id(), new ChatDtos.CreateRoom("Board-" + UUID.randomUUID().toString().substring(0, 20), null)).id(); chat.join(room, b.id()); }
    Account account() {
        var issued = auth.register(new AuthDtos.RegisterInput("board-" + UUID.randomUUID() + "@dqgm.dev", "Board Employee", "Password123"));
        return new Account(issued.response().user().id(), issued.response().accessToken());
    }
    JsonNode segment(long generation) {
        return mapper.valueToTree(Map.of("roomId", room, "operationId", UUID.randomUUID().toString(), "generation", generation,
            "color", "#1f2937", "width", 4, "points", List.of(Map.of("x", .1, "y", .2), Map.of("x", .8, "y", .9))));
    }
    JsonNode clear(long generation) { return mapper.valueToTree(Map.of("roomId", room, "operationId", UUID.randomUUID().toString(), "generation", generation)); }

    @Test void snapshotsAreMemberOnlyAndIdenticalRetriesDoNotDuplicate() throws Exception {
        mvc.perform(get("/api/rooms/" + room + "/whiteboard")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/rooms/" + room + "/whiteboard").header("Authorization", "Bearer " + outsider.token())).andExpect(status().isForbidden());
        var input = segment(0);
        ((com.fasterxml.jackson.databind.node.ObjectNode) input).put("authorId", outsider.id());
        var saved = boards.segment(a.id(), input);
        assertThat(saved.authorId()).isEqualTo(a.id());
        assertThat(boards.segment(a.id(), input)).isEqualTo(saved);
        var snapshot = boards.snapshot(room, b.id());
        assertThat(snapshot.revision()).isEqualTo(1); assertThat(snapshot.segments()).hasSize(1);
        ((com.fasterxml.jackson.databind.node.ObjectNode) input).put("color", "#dc2626");
        assertThatThrownBy(() -> boards.segment(a.id(), input)).isInstanceOf(ApiException.class);
        // Reload through a distinct HTTP request, using persisted rows rather than a process-local board cache.
        mvc.perform(get("/api/rooms/" + room + "/whiteboard").header("Authorization", "Bearer " + b.token()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.segments[0].authorId").value(a.id())).andExpect(jsonPath("$.revision").value(1));
    }

    @Test void concurrentAuthorsHaveOneDeterministicOrderAndIndependentRetryKeys() throws Exception {
        JsonNode one = segment(0), two = segment(0);
        ((com.fasterxml.jackson.databind.node.ObjectNode) two).put("operationId", one.path("operationId").asText());
        try (var pool = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            var first = pool.submit(() -> { start.await(); return boards.segment(a.id(), one); });
            var second = pool.submit(() -> { start.await(); return boards.segment(b.id(), two); });
            start.countDown(); first.get(10, TimeUnit.SECONDS); second.get(10, TimeUnit.SECONDS);
        }
        var snapshot = boards.snapshot(room, a.id());
        assertThat(snapshot.segments()).extracting(WhiteboardService.Segment::revision).containsExactly(1L, 2L);
        assertThat(snapshot.segments()).extracting(WhiteboardService.Segment::authorId).containsExactlyInAnyOrder(a.id(), b.id());
        assertThat(boards.segment(a.id(), one).revision()).isIn(1L, 2L);
        assertThat(boards.snapshot(room, a.id()).revision()).isEqualTo(2);
    }

    @Test void clearRetriesCannotEraseNewerWorkAndOldGenerationCannotReturn() {
        var old = segment(0); boards.segment(a.id(), old);
        var clear = clear(0); var cleared = boards.clear(b.id(), clear);
        assertThat(cleared.generation()).isEqualTo(1); assertThat(cleared.revision()).isEqualTo(2);
        boards.segment(a.id(), segment(1));
        assertThat(boards.clear(b.id(), clear)).isEqualTo(cleared);
        assertThat(boards.snapshot(room, a.id()).segments()).hasSize(1);
        assertThat(boards.snapshot(room, a.id()).revision()).isEqualTo(3);
        assertThatThrownBy(() -> boards.segment(a.id(), old)).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.reason).isEqualTo("stale_board"));
        assertThatThrownBy(() -> boards.clear(a.id(), clear(0))).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.reason).isEqualTo("stale_board"));
    }

    @Test void pointsStyleAndStorageBoundsAreEnforced() {
        var bad = (com.fasterxml.jackson.databind.node.ObjectNode) segment(0);
        bad.put("color", "url(javascript:bad)"); assertThatThrownBy(() -> boards.segment(a.id(), bad)).isInstanceOf(ApiException.class);
        bad.put("color", "#1f2937"); bad.put("width", 13); assertThatThrownBy(() -> boards.segment(a.id(), bad)).isInstanceOf(ApiException.class);
        bad.put("width", 4); bad.set("points", mapper.valueToTree(Collections.nCopies(49, Map.of("x", .1, "y", .2))));
        assertThatThrownBy(() -> boards.segment(a.id(), bad)).isInstanceOf(ApiException.class);
        bad.set("points", mapper.valueToTree(List.of(Map.of("x", -1, "y", .2)))); assertThatThrownBy(() -> boards.segment(a.id(), bad)).isInstanceOf(ApiException.class);
        boards.segment(a.id(), segment(0));
        var rows = new ArrayList<Object[]>();
        for (int i = 2; i <= WhiteboardService.MAX_SEGMENTS; i++) rows.add(new Object[] {room, a.id(), UUID.randomUUID().toString(), 0, i, "#1f2937", 4, "[{\"x\":0.1,\"y\":0.2}]", java.sql.Timestamp.from(Instant.now())});
        db.batchUpdate("INSERT INTO whiteboard_segments(room_id,author_id,operation_id,generation,revision,color,width,points_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)", rows);
        db.update("UPDATE whiteboards SET revision=? WHERE room_id=?", WhiteboardService.MAX_SEGMENTS, room);
        assertThatThrownBy(() -> boards.segment(a.id(), segment(0))).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.reason).isEqualTo("board_full"));
        boards.clear(a.id(), clear(0));
        assertThat(boards.segment(a.id(), segment(1)).revision()).isEqualTo(1002);
    }

    @Test void privateSocketEventsDenyOutsidersAndStopAfterLeave() throws Exception {
        try (var sender = new Socket(a); var receiver = new Socket(b); var other = new Socket(outsider)) {
            sender.subscribe("whiteboard"); receiver.subscribe("whiteboard"); other.subscribe("whiteboard");
            sender.barrier(); receiver.barrier(); other.barrier();
            var input = segment(0);
            assertThat(sender.request("whiteboard.segment", input).at("/payload/ok").asBoolean()).isTrue();
            assertThat(receiver.next("whiteboard:segment").at("/payload/roomId").asText()).isEqualTo(room);
            other.barrier(); assertThat(other.history.stream().noneMatch(e -> e.path("type").asText().startsWith("whiteboard:"))).isTrue();
            assertThat(other.request("whiteboard.segment", segment(0)).at("/payload/error/code").asText()).isEqualTo("forbidden");
            assertThat(other.request("whiteboard.clear", clear(0)).at("/payload/error/code").asText()).isEqualTo("forbidden");
            chat.leave(room, b.id());
            sender.request("whiteboard.segment", segment(0)); receiver.barrier();
            assertThat(receiver.history.stream().filter(e -> e.path("type").asText().equals("whiteboard:segment")).count()).isEqualTo(1);
            assertThatThrownBy(() -> boards.snapshot(room, b.id())).isInstanceOf(ApiException.class);
            chat.join(room, b.id()); assertThat(boards.snapshot(room, b.id()).segments()).hasSize(2);
        }
    }

    @Test void drawingRateLimitDoesNotConsumeChatQuotaAndOversizedPacketsGetNegativeAck() throws Exception {
        try (var socket = new Socket(a)) {
            for (int i = 0; i < 8; i++) assertThat(socket.request("whiteboard.segment", segment(0)).at("/payload/ok").asBoolean()).isTrue();
            assertThat(socket.request("whiteboard.segment", segment(0)).at("/payload/error/code").asText()).isEqualTo("rate_limited");
            assertThat(socket.request("message.send", Map.of("roomId", room, "content", "Chat remains usable", "clientMsgId", UUID.randomUUID().toString())).at("/payload/ok").asBoolean()).isTrue();
        }
        try (var socket = new Socket(a)) {
            var oversized = (com.fasterxml.jackson.databind.node.ObjectNode) segment(0); oversized.put("padding", "x".repeat(4500));
            assertThat(socket.request("whiteboard.segment", oversized).at("/payload/error/code").asText()).isEqualTo("invalid_payload");
            assertThat(socket.request("whiteboard.segment", segment(0)).at("/payload/ok").asBoolean()).isTrue();
        }
    }

    class Socket implements WebSocket.Listener, AutoCloseable {
        final WebSocket socket;
        final CompletableFuture<Void> connected = new CompletableFuture<>();
        final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        final List<JsonNode> history = new CopyOnWriteArrayList<>();
        final StringBuilder buffer = new StringBuilder();
        int subscriptions;
        Socket(Account user) throws Exception {
            socket = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", "http://localhost:" + port).subprotocols("v12.stomp")
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), this).join();
            send("CONNECT\naccept-version:1.2\nhost:localhost\nAuthorization:Bearer " + user.token() + "\n\n"); connected.get(5, TimeUnit.SECONDS);
            subscribe("acks"); subscribe("session"); barrier();
        }
        void subscribe(String queue) { send("SUBSCRIBE\nid:" + subscriptions++ + "\ndestination:/user/queue/" + queue + "\n\n"); }
        void send(String frame) { socket.sendText(frame + "\0", true).join(); }
        void barrier() throws Exception { send("SEND\ndestination:/app/session/ping\n\n{}"); next("session:pong"); }
        JsonNode next(String type) throws Exception {
            long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < end) { var item = messages.poll(Math.max(1, end - System.nanoTime()), TimeUnit.NANOSECONDS); assertThat(item).isNotNull(); if (type.equals(item.path("type").asText())) return item; }
            throw new AssertionError("Missing " + type);
        }
        JsonNode request(String destination, Object payload) throws Exception {
            String correlation = UUID.randomUUID().toString();
            send("SEND\ndestination:/app/" + destination + "\ncontent-type:application/json\n\n" + mapper.writeValueAsString(Map.of("type", destination.replace('.', ':'), "payload", payload, "ts", Instant.now().toString(), "correlationId", correlation)));
            var ack = next("ack"); assertThat(ack.at("/payload/correlationId").asText()).isEqualTo(correlation); return ack;
        }
        public void onOpen(WebSocket socket) { socket.request(1); }
        public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            buffer.append(data); int end;
            while ((end = buffer.indexOf("\0")) >= 0) {
                String frame = buffer.substring(0, end).stripLeading(); buffer.delete(0, end + 1);
                if (frame.startsWith("CONNECTED")) connected.complete(null);
                else if (frame.startsWith("MESSAGE")) try { var event = mapper.readTree(frame.substring(frame.indexOf("\n\n") + 2)); history.add(event); messages.add(event); } catch (Exception e) { connected.completeExceptionally(e); }
                else if (frame.startsWith("ERROR")) connected.completeExceptionally(new IllegalStateException("STOMP denied"));
            }
            socket.request(1); return null;
        }
        public void onError(WebSocket socket, Throwable error) { connected.completeExceptionally(error); }
        public void close() { socket.abort(); }
    }
}
