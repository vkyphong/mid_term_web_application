package dev.pulsechat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.auth.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.jdbc.core.JdbcTemplate;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @LocalServerPort int port;
    private String email() { return "user-" + UUID.randomUUID() + "@DQGM.dev"; }
    private MvcResult register(String email) throws Exception {
        return mvc.perform(post("/api/auth/register").contentType("application/json")
            .content(mapper.writeValueAsString(Map.of("email", email, "displayName", "Demo User", "password", "Password123"))))
            .andExpect(status().isCreated()).andReturn();
    }
    private JsonNode body(MvcResult result) throws Exception { return mapper.readTree(result.getResponse().getContentAsString()); }
    private Cookie cookie(MvcResult result) { return result.getResponse().getCookie("refreshToken"); }
    private String token(MvcResult result) throws Exception { return body(result).get("accessToken").asText(); }

    @Test void registersNormalizedUserAndStoresOnlyHashes() throws Exception {
        String email = email(); var result = register("  " + email.toUpperCase() + "  ");
        assertThat(body(result).at("/user/email").asText()).isEqualTo(email.toLowerCase());
        assertThat(result.getResponse().getHeader("Set-Cookie")).contains("HttpOnly", "SameSite=Strict", "Path=/api/auth");
        String hash = jdbc.queryForObject("select password_hash from users where id=?", String.class, body(result).at("/user/id").asText());
        assertThat(hash).startsWith("$2a$12$").doesNotContain("Password123");
        assertThat(jdbc.queryForList("select refresh_hash from auth_sessions", String.class)).doesNotContain(cookie(result).getValue());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token(result)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("user"));
    }
    @Test void rejectsDomainSpoofingAndWeakUnicodePassword() throws Exception {
        for (String email : List.of("a@evilDQGM.dev", "a@DQGM.dev.evil.com", "a@sub.DQGM.dev")) {
            mvc.perform(post("/api/auth/register").contentType("application/json").content(mapper.writeValueAsString(
                Map.of("email", email, "displayName", "Demo", "password", "Password123"))))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.reason").value("domain_not_allowed"));
        }
        mvc.perform(post("/api/auth/register").contentType("application/json").content(mapper.writeValueAsString(
            Map.of("email", email(), "displayName", "Demo", "password", "é".repeat(40) + "a1"))))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.details[0].field").value("password"));
    }
    @Test void duplicateAndLoginErrorsMatchContract() throws Exception {
        String email = email(); register(email);
        mvc.perform(post("/api/auth/register").contentType("application/json").content(mapper.writeValueAsString(
            Map.of("email", email, "displayName", "Demo", "password", "Password123"))))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.error.reason").value("email_taken"));
        for (String candidate : List.of(email, email())) {
            mvc.perform(post("/api/auth/login").contentType("application/json").content(mapper.writeValueAsString(
                Map.of("email", candidate, "password", "wrong123"))))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.reason").value("invalid_credentials"));
        }
        mvc.perform(post("/api/auth/login").contentType("application/json").content(mapper.writeValueAsString(
            Map.of("email", email, "password", "Password123")))).andExpect(status().isOk());
    }
    @Test void rotatesRefreshAndRevokesLogoutAccessAndCookie() throws Exception {
        var registered = register(email()); var old = cookie(registered);
        var refreshed = mvc.perform(post("/api/auth/refresh").cookie(old)).andExpect(status().isOk()).andReturn();
        assertThat(cookie(refreshed).getValue()).isNotEqualTo(old.getValue());
        mvc.perform(post("/api/auth/refresh").cookie(old)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").cookie(cookie(refreshed))).andExpect(status().isNoContent())
            .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        mvc.perform(post("/api/auth/refresh").cookie(cookie(refreshed))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token(refreshed))).andExpect(status().isUnauthorized());
    }
    @Test void concurrentRefreshOnlySucceedsOnce() throws Exception {
        var registered = register(email()); var original = cookie(registered);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var work = (Callable<Integer>) () -> mvc.perform(post("/api/auth/refresh").cookie(original)).andReturn().getResponse().getStatus();
            var a = pool.submit(work); var b = pool.submit(work);
            assertThat(List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS))).containsExactlyInAnyOrder(200, 401);
        }
    }
    @Test void logoutWithPreRotationCookieStillRevokesTheSession() throws Exception {
        var registered = register(email());
        var rotated = mvc.perform(post("/api/auth/refresh").cookie(cookie(registered))).andExpect(status().isOk()).andReturn();
        mvc.perform(post("/api/auth/logout").cookie(cookie(registered))).andExpect(status().isNoContent());
        mvc.perform(post("/api/auth/refresh").cookie(cookie(rotated))).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token(rotated))).andExpect(status().isUnauthorized());
    }
    @Test void stompRejectsBannedUserAndFramesBeforeConnect() throws Exception {
        var registered = register(email());
        jdbc.update("update users set enabled=false where id=?", body(registered).at("/user/id").asText());
        try (var socket = new StompSocket("http://localhost:" + port)) {
            socket.connect(token(registered)); assertThat(socket.next()).contains("ERROR", "banned");
        }
        try (var socket = new StompSocket("http://localhost:" + port)) {
            socket.send("SUBSCRIBE\nid:unauthed\ndestination:/user/queue/session\n\n");
            // The STOMP transport may close immediately before a CONNECTED session exists.
            assertThat(socket.closed.get(7, TimeUnit.SECONDS)).isIn(1002, 1008);
        }
    }
    @Test void missingExpiredAndTamperedTokensAreRejected() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/refresh")).andExpect(status().isUnauthorized());
        var registered = register(email());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer invalid")).andExpect(status().isUnauthorized());
        jdbc.update("update auth_sessions set expires_at = ? where user_id = ?", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(1)), body(registered).at("/user/id").asText());
        mvc.perform(post("/api/auth/refresh").cookie(cookie(registered))).andExpect(status().isUnauthorized());
    }
    @Test void bansBlockLoginRefreshAndRest() throws Exception {
        String email = email(); var registered = register(email);
        jdbc.update("update users set enabled=false where email=?", email.toLowerCase());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token(registered))).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/refresh").cookie(cookie(registered))).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/login").contentType("application/json").content(mapper.writeValueAsString(
            Map.of("email", email, "password", "Password123")))).andExpect(status().isForbidden());
    }
    @Test void rejectsCrossOriginCookieRequestsAndMalformedJson() throws Exception {
        mvc.perform(post("/api/auth/logout").header("Origin", "https://evil.example")).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("invalid_payload"));
        mvc.perform(post("/api/auth/login").contentType("application/json").content("{}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.reason").value("validation"));
    }

    private class StompSocket implements WebSocket.Listener, AutoCloseable {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        final CompletableFuture<Integer> closed = new CompletableFuture<>();
        final StringBuilder buffer = new StringBuilder();
        final WebSocket socket;
        StompSocket(String origin) {
            socket = HttpClient.newHttpClient().newWebSocketBuilder().header("Origin", origin).subprotocols("v12.stomp")
                .buildAsync(URI.create("ws://localhost:" + port + "/ws"), this).join();
        }
        void send(String text) { socket.sendText(text + "\u0000", true).join(); }
        void connect(String token) { send("CONNECT\naccept-version:1.2\nhost:localhost\nheart-beat:0,0\n" + (token == null ? "" : "Authorization:Bearer " + token + "\n") + "\n"); }
        String next() throws Exception { String value = frames.poll(4, TimeUnit.SECONDS); assertThat(value).isNotNull(); return value; }
        @Override public void onOpen(WebSocket ws) { ws.request(1); }
        @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) { String value = buffer.toString(); buffer.setLength(0); if (!value.isBlank()) frames.add(value); }
            ws.request(1); return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket ws, int code, String reason) { closed.complete(code); return null; }
        @Override public void onError(WebSocket ws, Throwable error) { closed.completeExceptionally(error); }
        @Override public void close() { socket.abort(); }
    }
    @Test void stompConnectRequiresValidTokenAndAllowsPrivateProbe() throws Exception {
        var registered = register(email());
        try (var socket = new StompSocket("http://localhost:" + port)) {
            socket.connect(token(registered)); assertThat(socket.next()).startsWith("CONNECTED");
            socket.send("SUBSCRIBE\nid:probe\ndestination:/user/queue/session\n\n");
            socket.send("SEND\ndestination:/app/session/ping\n\n{}");
            assertThat(socket.next()).contains("session:pong", body(registered).at("/user/id").asText());
        }
        for (String token : Arrays.asList(null, "bad.jwt.token")) {
            try (var socket = new StompSocket("http://localhost:" + port)) {
                socket.connect(token); assertThat(socket.next()).contains("ERROR", "unauthorized");
            }
        }
    }
    @Test void stompRejectsOriginAndUnauthorizedDestinations() throws Exception {
        assertThatThrownBy(() -> new StompSocket("https://evil.example")).hasCauseInstanceOf(WebSocketHandshakeException.class);
        for (String command : List.of("SEND\ndestination:/queue/session", "SUBSCRIBE\nid:other\ndestination:/topic/any", "SUBSCRIBE\nid:other\ndestination:/user/someone/queue/session")) {
            var registered = register(email());
            try (var socket = new StompSocket("http://localhost:" + port)) {
                socket.connect(token(registered)); assertThat(socket.next()).startsWith("CONNECTED");
                socket.send(command + "\n\n" + (command.startsWith("SEND") ? "{}" : "")); assertThat(socket.next()).contains("ERROR", "forbidden");
            }
        }
    }
    @Test void logoutClosesConnectedSocket() throws Exception {
        var registered = register(email());
        try (var socket = new StompSocket("http://localhost:" + port)) {
            socket.connect(token(registered)); assertThat(socket.next()).startsWith("CONNECTED");
            mvc.perform(post("/api/auth/logout").cookie(cookie(registered))).andExpect(status().isNoContent());
            assertThat(socket.closed.get(3, TimeUnit.SECONDS)).isEqualTo(1008);
        }
    }
    @Test void capsConnectionsAndClosesExpiredSocket() throws Exception {
        var registered = register(email()); var sockets = new ArrayList<StompSocket>();
        try {
            for (int i = 0; i < 5; i++) {
                var socket = new StompSocket("http://localhost:" + port); sockets.add(socket);
                socket.connect(token(registered)); assertThat(socket.next()).startsWith("CONNECTED");
            }
            try (var sixth = new StompSocket("http://localhost:" + port)) {
                sixth.connect(token(registered)); assertThat(sixth.next()).contains("ERROR", "connection_limit");
            }
            assertThat(sockets.getFirst().closed.get(7, TimeUnit.SECONDS)).isEqualTo(1008);
            mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token(registered))).andExpect(status().isUnauthorized());
        } finally { sockets.forEach(StompSocket::close); }
    }
    @Test void unauthenticatedIdleSocketIsClosed() throws Exception {
        try (var socket = new StompSocket("http://localhost:" + port)) {
            assertThat(socket.closed.get(7, TimeUnit.SECONDS)).isEqualTo(1008);
        }
    }
}
