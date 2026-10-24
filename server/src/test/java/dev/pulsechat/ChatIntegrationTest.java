package dev.pulsechat;

import com.fasterxml.jackson.databind.*;
import dev.pulsechat.auth.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "app.access-ttl-seconds=900")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ChatIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate db;
    @LocalServerPort int port;
    record Account(String id, String token) {}
    Account a, b, c;
    @BeforeAll void accounts() {
        a = account(); b = account(); c = account();
    }
    private Account account() {
        var issued = auth.register(new AuthDtos.RegisterInput("chat-" + UUID.randomUUID() + "@DQGM.dev", "Chat Employee", "Password123"));
        return new Account(issued.response().user().id(), issued.response().accessToken());
    }
    private JsonNode postJson(String path, Account account, Object body, int status) throws Exception {
        var result = mvc.perform(post(path).header("Authorization", "Bearer " + account.token()).contentType("application/json")
            .content(mapper.writeValueAsString(body))).andExpect(status().is(status)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsString());
    }
    private JsonNode getJson(String path, Account account, int status) throws Exception {
        var result = mvc.perform(get(path).header("Authorization", "Bearer " + account.token())).andExpect(status().is(status)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsString());
    }
    private String channel() throws Exception { return postJson("/api/rooms", a, Map.of("name", "Test-" + UUID.randomUUID().toString().substring(0, 24)), 201).path("id").asText(); }
    private Map<String, String> message(String room, String text, String id) { return Map.of("roomId", room, "content", text, "clientMsgId", id); }

    @Test void validatesRoomsSearchAndHistoryParameters() throws Exception {
        var rooms = getJson("/api/rooms", a, 200).path("rooms");
        assertThat(rooms.findValuesAsText("name")).contains("Engineering", "HR", "Sales", "Marketing");
        String name = "Unique-" + UUID.randomUUID().toString().substring(0, 16);
        var created = postJson("/api/rooms", a, Map.of("name", " " + name + " "), 201);
        assertThat(created.path("joined").asBoolean()).isTrue();
        assertThat(created.path("memberCount").asInt()).isEqualTo(1);
        assertThat(created.has("peer")).isTrue(); assertThat(created.path("peer").isNull()).isTrue();
        assertThat(postJson("/api/rooms", b, Map.of("name", name.toUpperCase()), 409).at("/error/reason").asText()).isEqualTo("room_name_taken");
        postJson("/api/rooms", a, Map.of("name", "x"), 400);
        postJson("/api/rooms", a, Map.of("name", "Valid", "description", "a".repeat(201)), 400);
        postJson("/api/dms", a, Map.of("userId", a.id()), 400);
        postJson("/api/dms", a, Map.of("userId", UUID.randomUUID().toString()), 400);
        assertThat(getJson("/api/users?search=Chat&limit=20", a, 200).path("users").findValuesAsText("id")).contains(b.id(), c.id()).doesNotContain(a.id());
        assertThat(getJson("/api/users?search=%25", a, 200).path("users").size()).isZero();
        getJson("/api/users?limit=21", a, 400); getJson("/api/users?limit=bad", a, 400);
        String room = created.path("id").asText();
        getJson("/api/rooms/" + room + "/messages", b, 403);
        getJson("/api/rooms/missing/messages", a, 404);
        getJson("/api/rooms/" + room + "/messages?before=bad", a, 400);
        getJson("/api/rooms/" + room + "/messages?limit=0", a, 400);
    }

    @Test void channelBroadcastAckIsolationLeaveAndRetry() throws Exception {
        String room = channel();
        try (var sa = new Socket(a); var sa2 = new Socket(a); var sb = new Socket(b); var outsider = new Socket(c)) {
            assertThat(sb.request("room.join", "room:join", Map.of("roomId", room)).at("/payload/ok").asBoolean()).isTrue();
            String clientId = UUID.randomUUID().toString();
            var ack = sa.request("message.send", "message:send", message(room, " Chào cả nhóm ", clientId));
            assertThat(ack.at("/payload/ok").asBoolean()).isTrue();
            String id = ack.at("/payload/data/id").asText();
            assertThat(ack.at("/payload/data/createdAt").isTextual()).isTrue();
            // Ack arrives after commit; the message is already readable over REST.
            assertThat(getJson("/api/rooms/" + room + "/messages", b, 200).at("/messages/0/id").asText()).isEqualTo(id);
            for (Socket socket : List.of(sa, sa2, sb)) {
                var event = socket.next(); assertThat(event.path("type").asText()).isEqualTo("message:new");
                assertThat(event.at("/payload/content").asText()).isEqualTo("Chào cả nhóm");
            }
            sa2.barrier(); outsider.barrier(); // no ack on the other sender session, no outsider broadcast
            var retry = sa.request("message.send", "message:send", message(room, "Chào cả nhóm", clientId));
            assertThat(retry.at("/payload/data/id").asText()).isEqualTo(id);
            sa.barrier(); sb.barrier();
            assertThat(getJson("/api/rooms/" + room + "/messages", a, 200).path("messages").size()).isEqualTo(1);
            sb.request("room.leave", "room:leave", Map.of("roomId", room));
            var denied = sb.request("message.send", "message:send", message(room, "blocked", UUID.randomUUID().toString()));
            assertThat(denied.at("/payload/error/code").asText()).isEqualTo("forbidden");
            sa.request("message.send", "message:send", message(room, "after leave", UUID.randomUUID().toString()));
            sa.next(); sa2.next(); sb.barrier(); outsider.barrier();
            getJson("/api/rooms/" + room + "/messages", b, 403);
            assertThat(sb.request("room.join", "room:join", Map.of("roomId", room)).at("/payload/ok").asBoolean()).isTrue();
            assertThat(sb.request("room.join", "room:join", Map.of("roomId", room)).at("/payload/data/memberCount").asInt()).isEqualTo(2);
        }
    }

    @Test void dmCreationIsConcurrentAndPrivate() throws Exception {
        // Use a fresh pair so this test always exercises the initial concurrent insert.
        Account left = account(), right = account(); String room;
        try (var pool = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            var first = pool.submit(() -> { start.await(); return postJson("/api/dms", left, Map.of("userId", right.id()), 200); });
            var second = pool.submit(() -> { start.await(); return postJson("/api/dms", right, Map.of("userId", left.id()), 200); });
            start.countDown(); var one = first.get(10, TimeUnit.SECONDS); var two = second.get(10, TimeUnit.SECONDS);
            room = one.path("id").asText(); assertThat(two.path("id").asText()).isEqualTo(room);
            assertThat(one.path("memberCount").asInt()).isEqualTo(2);
            assertThat(one.at("/peer/id").asText()).isEqualTo(right.id());
        }
        assertThat(getJson("/api/rooms", c, 200).path("rooms").findValuesAsText("id")).doesNotContain(room);
        try (var sender = new Socket(left); var receiver = new Socket(right); var third = new Socket(c)) {
            for (String action : List.of("join", "leave")) {
                assertThat(third.request("room." + action, "room:" + action, Map.of("roomId", room)).at("/payload/error/code").asText()).isEqualTo("forbidden");
                assertThat(sender.request("room." + action, "room:" + action, Map.of("roomId", room)).at("/payload/error/code").asText()).isEqualTo("forbidden");
            }
            assertThat(third.request("message.send", "message:send", message(room, "attack", UUID.randomUUID().toString())).at("/payload/error/code").asText()).isEqualTo("forbidden");
            sender.request("message.send", "message:send", message(room, "private", UUID.randomUUID().toString()));
            sender.next(); assertThat(receiver.next().at("/payload/content").asText()).isEqualTo("private");
            third.barrier(); getJson("/api/rooms/" + room + "/messages", c, 403);
        }
    }

    @Test void validatesSocketPayloadsWithoutClosingAndPagesTiedTimestamps() throws Exception {
        String room = channel();
        try (var socket = new Socket(a)) {
            assertThat(socket.request("message.send", "room:join", Map.of("roomId", room)).at("/payload/error/code").asText()).isEqualTo("invalid_payload");
            for (String text : List.of(" ", "é".repeat(1025)))
                assertThat(socket.request("message.send", "message:send", message(room, text, UUID.randomUUID().toString())).at("/payload/error/code").asText()).isEqualTo("invalid_payload");
            assertThat(socket.request("message.send", "message:send", message(room, "hello", "bad")).at("/payload/error/code").asText()).isEqualTo("invalid_payload");
            for (int i = 0; i < 4; i++) {
                socket.request("message.send", "message:send", message(room, "Page " + i, UUID.randomUUID().toString())); socket.next();
            }
            socket.barrier();
        }
        db.update("UPDATE messages SET created_at=? WHERE room_id=?", java.sql.Timestamp.from(Instant.parse("2026-10-21T01:00:00Z")), room);
        var newest = getJson("/api/rooms/" + room + "/messages?limit=2", a, 200);
        String cursor = newest.path("nextCursor").asText();
        var oldest = getJson("/api/rooms/" + room + "/messages?limit=2&before=" + cursor, a, 200);
        assertThat(newest.path("messages").size()).isEqualTo(2);
        assertThat(oldest.path("messages").size()).isEqualTo(2);
        var ids = new HashSet<String>();
        newest.path("messages").forEach(m -> ids.add(m.path("id").asText()));
        oldest.path("messages").forEach(m -> ids.add(m.path("id").asText()));
        assertThat(ids).hasSize(4);
        assertThat(oldest.path("nextCursor").isNull()).isTrue();
    }

    private class Socket implements WebSocket.Listener, AutoCloseable {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        final StringBuilder buffer = new StringBuilder(); final WebSocket ws;
        Socket(Account account) throws Exception {
            ws = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", "http://localhost:" + port).subprotocols("v12.stomp")
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), this).join();
            send("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:0,0\nAuthorization:Bearer " + account.token() + "\n\n");
            assertThat(raw()).startsWith("CONNECTED");
            int id = 0;
            for (String queue : List.of("acks", "events", "session")) send("SUBSCRIBE\nid:" + id++ + "\ndestination:/user/queue/" + queue + "\n\n");
            barrier();
        }
        void send(String frame) { ws.sendText(frame + "\u0000", true).join(); }
        String raw() throws Exception { String frame = frames.poll(5, TimeUnit.SECONDS); assertThat(frame).isNotNull(); return frame; }
        JsonNode next() throws Exception { String frame = raw(); assertThat(frame).startsWith("MESSAGE"); return mapper.readTree(frame.substring(frame.indexOf("\n\n") + 2)); }
        void barrier() throws Exception {
            send("SEND\ndestination:/app/session/ping\ncontent-type:application/json\n\n{}");
            assertThat(next().path("type").asText()).isEqualTo("session:pong");
        }
        JsonNode request(String destination, String type, Object payload) throws Exception {
            String id = UUID.randomUUID().toString();
            send("SEND\ndestination:/app/" + destination + "\ncontent-type:application/json\n\n" + mapper.writeValueAsString(Map.of("type", type, "payload", payload, "correlationId", id, "ts", Instant.now().toString())));
            var ack = next(); assertThat(ack.path("type").asText()).isEqualTo("ack");
            assertThat(ack.at("/payload/correlationId").asText()).isEqualTo(id); return ack;
        }
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            buffer.append(data);
            int end;
            while ((end = buffer.indexOf("\u0000")) >= 0) {
                String frame = buffer.substring(0, end).stripLeading(); buffer.delete(0, end + 1);
                if (!frame.isBlank()) frames.add(frame);
            }
            socket.request(1); return null;
        }
        @Override public void close() { ws.abort(); }
    }
}
