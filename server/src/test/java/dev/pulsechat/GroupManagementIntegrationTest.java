package dev.pulsechat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.auth.AuthDtos;
import dev.pulsechat.auth.AuthService;
import dev.pulsechat.chat.ChatDtos;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.chat.MessageActions;
import dev.pulsechat.common.ApiException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"app.access-ttl-seconds=900", "app.upload-directory=${java.io.tmpdir}/pulsechat-test-uploads"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class GroupManagementIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate db;
    @Autowired AuthService auth;
    @Autowired ChatService chat;
    @Autowired MessageActions actions;
    record Account(String id, String token) {}
    Account owner, peer, outsider, admin;

    @BeforeAll void accounts() {
        owner = account(); peer = account(); outsider = account(); admin = account();
        db.update("UPDATE users SET role='admin' WHERE id=?", admin.id());
    }
    private Account account() {
        var issued = auth.register(new AuthDtos.RegisterInput("group-" + UUID.randomUUID() + "@DQGM.dev", "Group Employee", "Password123"));
        return new Account(issued.response().user().id(), issued.response().accessToken());
    }
    private String room() { return chat.createRoom(owner.id(), new ChatDtos.CreateRoom("Group-" + UUID.randomUUID().toString().substring(0, 24), null)).id(); }
    private JsonNode call(HttpMethod method, String path, Account actor, Object body, int status) throws Exception {
        var request = request(method, java.net.URI.create(path)).header("Authorization", "Bearer " + actor.token());
        if (body != null) request.contentType("application/json").content(mapper.writeValueAsString(body));
        String result = mvc.perform(request).andExpect(status().is(status)).andReturn().getResponse().getContentAsString();
        return result.isBlank() ? mapper.createObjectNode() : mapper.readTree(result);
    }
    private JsonNode get(String path, Account actor, int status) throws Exception { return call(HttpMethod.GET, path, actor, null, status); }
    private JsonNode post(String path, Account actor, Object body, int status) throws Exception { return call(HttpMethod.POST, path, actor, body, status); }
    private JsonNode upload(String room, Account actor, String name, byte[] bytes, int status) throws Exception {
        var result = mvc.perform(multipart("/api/uploads").file(new MockMultipartFile("file", name, "application/octet-stream", bytes))
            .param("roomId", room).header("Authorization", "Bearer " + actor.token())).andExpect(status().is(status)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private static byte[] png() throws Exception {
        var out = new ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(4, 4, java.awt.image.BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
    private JsonNode avatar(String room, Account actor, String name, byte[] bytes, int status) throws Exception {
        var result = mvc.perform(multipart("/api/rooms/" + room + "/avatar").file(new MockMultipartFile("file", name, "application/octet-stream", bytes))
            .header("Authorization", "Bearer " + actor.token())).andExpect(status().is(status)).andReturn();
        return mapper.readTree(result.getResponse().getContentAsString());
    }
    private ChatDtos.Room listed(String room, Account actor) {
        return chat.listRooms(actor.id()).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow();
    }

    @Test void membersRenameGroupsButNotDmsOutsidersOrArchivedGroups() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        String renamed = "Đổi tên " + UUID.randomUUID().toString().substring(0, 8);
        assertThat(call(HttpMethod.PATCH, "/api/rooms/" + room, peer, Map.of("name", "  " + renamed + " "), 200).path("name").asText()).isEqualTo(renamed);
        assertThat(listed(room, owner).name()).isEqualTo(renamed);
        call(HttpMethod.PATCH, "/api/rooms/" + room, outsider, Map.of("name", "Người ngoài"), 403);
        call(HttpMethod.PATCH, "/api/rooms/" + room, owner, Map.of("name", "x"), 400);
        String other = room();
        call(HttpMethod.PATCH, "/api/rooms/" + other, owner, Map.of("name", renamed.toUpperCase()), 409);
        String dm = chat.openDm(owner.id(), new ChatDtos.OpenDm(outsider.id())).id();
        call(HttpMethod.PATCH, "/api/rooms/" + dm, owner, Map.of("name", "Không được"), 403);
        post("/api/admin/groups/" + room + "/archive", admin, Map.of("archived", true), 200);
        call(HttpMethod.PATCH, "/api/rooms/" + room, owner, Map.of("name", "Sau lưu trữ"), 409);
    }

    @Test void dmNicknamesArePrivateToTheirAuthor() throws Exception {
        Account a = account(), b = account();
        String dm = chat.openDm(a.id(), new ChatDtos.OpenDm(b.id())).id();
        assertThat(call(HttpMethod.PUT, "/api/rooms/" + dm + "/nickname", a, Map.of("nickname", " Bạn thân "), 200).path("name").asText()).isEqualTo("Bạn thân");
        assertThat(listed(dm, a).nickname()).isEqualTo("Bạn thân");
        assertThat(listed(dm, a).peer().displayName()).isEqualTo("Group Employee");
        assertThat(listed(dm, b).name()).isEqualTo("Group Employee");
        assertThat(listed(dm, b).nickname()).isNull();
        call(HttpMethod.PUT, "/api/rooms/" + dm + "/nickname", a, Map.of("nickname", ""), 200);
        assertThat(listed(dm, a).nickname()).isNull();
        call(HttpMethod.PUT, "/api/rooms/" + dm + "/nickname", a, Map.of("nickname", "x".repeat(41)), 400);
        call(HttpMethod.PUT, "/api/rooms/" + dm + "/nickname", outsider, Map.of("nickname", "Lạ"), 403);
        call(HttpMethod.PUT, "/api/rooms/" + room() + "/nickname", owner, Map.of("nickname", "Kênh"), 400);
    }

    @Test void groupAvatarsDefaultToMemberPreviewAndCanBeReplacedByMembers() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        var before = listed(room, owner);
        assertThat(before.avatarUrl()).isNull();
        assertThat(before.previewMembers()).extracting(ChatDtos.UserSummary::id).containsExactly(peer.id(), owner.id());
        assertThat(listed(room, outsider).previewMembers()).isEmpty();

        String url = avatar(room, peer, "nhom.png", png(), 200).path("avatarUrl").asText();
        assertThat(url).startsWith("/api/rooms/" + room + "/avatar?v=");
        assertThat(listed(room, owner).avatarUrl()).isEqualTo(url);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url).header("Authorization", "Bearer " + owner.token()))
            .andExpect(status().isOk()).andExpect(header().string("Content-Type", "image/png")).andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url).header("Authorization", "Bearer " + outsider.token())).andExpect(status().isForbidden());
        avatar(room, outsider, "nhom.png", png(), 403);
        avatar(room, owner, "nhom.pdf", "%PDF-1.4".getBytes(StandardCharsets.UTF_8), 400);
        avatar(room, owner, "gia.png", "not an image".getBytes(StandardCharsets.UTF_8), 400);

        call(HttpMethod.DELETE, "/api/rooms/" + room + "/avatar", owner, null, 200);
        assertThat(listed(room, owner).avatarUrl()).isNull();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/rooms/" + room + "/avatar").header("Authorization", "Bearer " + owner.token())).andExpect(status().isNotFound());
    }

    @Test void unreadCountFollowsSeenReceiptsAndOwnReplies() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        java.util.function.Supplier<Integer> unread = () -> chat.listRooms(peer.id()).stream()
            .filter(r -> r.id().equals(room)).findFirst().orElseThrow().unreadCount();
        var first = chat.send(room, owner.id(), "một", UUID.randomUUID().toString()).message();
        chat.send(room, owner.id(), "hai", UUID.randomUUID().toString());
        var third = chat.send(room, owner.id(), "ba", UUID.randomUUID().toString()).message();
        assertThat(unread.get()).isEqualTo(3);
        assertThat(chat.listRooms(owner.id()).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow().unreadCount()).isZero();
        actions.change(peer.id(), first.id(), "seen", null, "", false);
        assertThat(unread.get()).isEqualTo(2);
        actions.change(owner.id(), third.id(), "delete", null, "", false);
        assertThat(unread.get()).isEqualTo(1);
        // Trả lời trong phòng nghĩa là đã đọc tới đó.
        chat.send(room, peer.id(), "đã đọc", UUID.randomUUID().toString());
        assertThat(unread.get()).isZero();
        chat.send(room, owner.id(), "bốn", UUID.randomUUID().toString());
        JsonNode listed = null;
        for (JsonNode r : get("/api/rooms", peer, 200).path("rooms")) if (r.path("id").asText().equals(room)) listed = r;
        assertThat(listed).isNotNull();
        assertThat(listed.path("unreadCount").asInt()).isEqualTo(1);
        // Người ngoài chưa tham gia kênh: không đếm.
        assertThat(chat.listRooms(outsider.id()).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow().unreadCount()).isZero();
    }

    @Test void membersCanAddEmployeesIdempotentlyButOutsidersCannot() throws Exception {
        String room = room(); String path = "/api/rooms/" + room + "/members";
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path)).andExpect(status().isUnauthorized());
        get(path, outsider, 403);
        post(path, outsider, Map.of("userId", peer.id()), 403);
        post(path, owner, Map.of(), 400);
        post(path, owner, Map.of("userId", UUID.randomUUID().toString()), 400);
        for (int i = 0; i < 2; i++) assertThat(post(path, owner, Map.of("userId", peer.id()), 200).path("memberCount").asInt()).isEqualTo(2);
        assertThat(chat.listRooms(peer.id()).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow().joined()).isTrue();
        post(path, peer, Map.of("userId", outsider.id()), 200);
        var members = get(path, owner, 200).path("members");
        assertThat(members).hasSize(3);
        for (JsonNode member : members) {
            assertThat(member.has("enabled")).isTrue();
            assertThat(member.has("passwordHash")).isFalse();
            assertThat(member.has("role")).isFalse();
        }
        Account banned = account();
        chat.addMember(room, owner.id(), new ChatDtos.AddMember(banned.id()));
        db.update("UPDATE users SET enabled=false WHERE id=?", banned.id());
        assertThat(get(path, owner, 200).path("members")).hasSize(4);
        assertThat(get(path, owner, 200).path("members").findValuesAsText("id")).contains(banned.id());
        post("/api/rooms/" + room() + "/members", owner, Map.of("userId", banned.id()), 400);
        String dm = chat.openDm(owner.id(), new ChatDtos.OpenDm(peer.id())).id();
        post("/api/rooms/" + dm + "/members", owner, Map.of("userId", outsider.id()), 403);
        assertThat(get("/api/rooms/" + dm + "/members", owner, 200).path("members")).hasSize(2);
    }
    @Test void concurrentAddsDoNotCreateDuplicateMemberships() throws Exception {
        String room = room();
        try (var pool = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            Callable<JsonNode> task = () -> { start.await(); return post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200); };
            var first = pool.submit(task); var second = pool.submit(task); start.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS).path("memberCount").asInt()).isEqualTo(2);
            assertThat(second.get(10, TimeUnit.SECONDS).path("memberCount").asInt()).isEqualTo(2);
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=?", Integer.class, room)).isEqualTo(2);
    }
    @Test void adminCanManageIdleGroupsWithoutAccessToDms() throws Exception {
        String name = "Admin%_-" + UUID.randomUUID().toString().substring(0, 16);
        var created = post("/api/admin/groups", admin, Map.of("name", name, "description", "Original"), 201);
        String id = created.path("id").asText();
        assertThat(created.path("memberCount").asInt()).isEqualTo(1);
        assertThat(created.path("archived").asBoolean()).isFalse();
        assertThat(get("/api/admin/groups?search=Admin%25_", admin, 200).path("groups").findValuesAsText("id")).contains(id);
        assertThat(get("/api/admin/groups?search=Admin%25_&page=1", admin, 200).path("groups")).isEmpty();
        assertThat(get("/api/admin/groups/" + id, admin, 200).path("name").asText()).isEqualTo(name);
        post("/api/admin/groups", admin, Map.of("name", name.toLowerCase()), 409);
        String renamed = "Renamed-" + UUID.randomUUID().toString().substring(0, 16);
        assertThat(call(HttpMethod.PATCH, "/api/admin/groups/" + id, admin, Map.of("name", renamed, "description", "New"), 200).path("description").asText()).isEqualTo("New");
        String other = room();
        String otherName = get("/api/admin/groups/" + other, admin, 200).path("name").asText();
        assertThat(call(HttpMethod.PATCH, "/api/admin/groups/" + id, admin, Map.of("name", otherName.toUpperCase()), 409).at("/error/reason").asText()).isEqualTo("room_name_taken");
        assertThat(get("/api/admin/groups/" + id, admin, 200).path("name").asText()).isEqualTo(renamed);
        post("/api/admin/groups/" + id + "/members", admin, Map.of("userId", owner.id()), 200);
        assertThat(get("/api/admin/groups/" + id + "/members", admin, 200).path("members")).hasSize(2);
        // Admin membership is not required to manage a channel.
        call(HttpMethod.DELETE, "/api/admin/groups/" + id + "/members/" + admin.id(), admin, null, 200);
        assertThat(get("/api/admin/groups/" + id + "/members", admin, 200).path("members")).hasSize(1);
        chat.send(id, owner.id(), "Before removal", UUID.randomUUID().toString());
        for (int i = 0; i < 2; i++) call(HttpMethod.DELETE, "/api/admin/groups/" + id + "/members/" + owner.id(), admin, null, 200);
        assertThatThrownBy(() -> chat.send(id, owner.id(), "Blocked", UUID.randomUUID().toString())).isInstanceOf(ApiException.class);
        get("/api/rooms/" + id + "/messages", owner, 403);
        String dm = chat.openDm(owner.id(), new ChatDtos.OpenDm(peer.id())).id();
        for (String suffix : List.of("", "/members")) get("/api/admin/groups/" + dm + suffix, admin, 404);
        post("/api/admin/groups/" + dm + "/members", admin, Map.of("userId", outsider.id()), 404);
        post("/api/admin/groups/" + dm + "/archive", admin, Map.of("archived", true), 404);
        call(HttpMethod.PATCH, "/api/admin/groups/" + dm, admin, Map.of("name", "No access"), 404);
        call(HttpMethod.DELETE, "/api/admin/groups/" + dm + "/members/" + peer.id(), admin, null, 404);
        get("/api/admin/groups/missing", admin, 404);
        get("/api/admin/groups?page=-1", admin, 400);
        get("/api/admin/groups?archived=bad", admin, 400);
        post("/api/admin/groups", admin, Map.of("name", "x"), 400);
    }
    @Test void adminRoleIsRequiredForEveryManagementEndpoint() throws Exception {
        String room = room();
        for (String suffix : List.of("", "/" + room, "/" + room + "/members")) get("/api/admin/groups" + suffix, owner, 403);
        post("/api/admin/groups", owner, Map.of("name", "Unauthorized"), 403);
        call(HttpMethod.PATCH, "/api/admin/groups/" + room, owner, Map.of("name", "Unauthorized"), 403);
        post("/api/admin/groups/" + room + "/archive", owner, Map.of("archived", true), 403);
        post("/api/admin/groups/" + room + "/members", owner, Map.of("userId", outsider.id()), 403);
        call(HttpMethod.DELETE, "/api/admin/groups/" + room + "/members/" + owner.id(), owner, null, 403);
        for (String method : List.of("PATCH", "DELETE")) mvc.perform(options("/api/admin/groups/" + room)
            .header("Origin", "http://localhost:5173").header("Access-Control-Request-Method", method)
            .header("Access-Control-Request-Headers", "Authorization,Content-Type"))
            .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }
    @Test void archivedGroupsKeepHistoryButRejectNewMessagesJoinsAndUploads() throws Exception {
        String room = room(); chat.send(room, owner.id(), "Preserved", UUID.randomUUID().toString());
        post("/api/admin/groups/" + room + "/archive", admin, Map.of("archived", true), 200);
        assertThat(get("/api/admin/groups?archived=true", admin, 200).path("groups").findValuesAsText("id")).contains(room);
        assertThat(get("/api/rooms/" + room + "/messages", owner, 200).at("/messages/0/content").asText()).isEqualTo("Preserved");
        assertThat(chat.listRooms(owner.id()).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow().archived()).isTrue();
        assertThatThrownBy(() -> chat.send(room, owner.id(), "blocked", UUID.randomUUID().toString())).isInstanceOf(ApiException.class).hasMessageContaining("archived");
        assertThatThrownBy(() -> chat.join(room, peer.id())).isInstanceOf(ApiException.class);
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 409);
        post("/api/admin/groups/" + room + "/members", admin, Map.of("userId", peer.id()), 409);
        upload(room, owner, "test.txt", "hello".getBytes(StandardCharsets.UTF_8), 409);
        post("/api/admin/groups/" + room + "/archive", admin, Map.of(), 400);
        post("/api/admin/groups/" + room + "/archive", admin, Map.of("archived", false), 200);
        chat.join(room, peer.id()); chat.send(room, owner.id(), "Reopened", UUID.randomUUID().toString());
        assertThat(get("/api/rooms/" + room + "/messages", peer, 200).path("messages")).hasSize(2);
    }
    @Test void expandedFileTypesCanBeAttachedDownloadedAndRevokedWithMembership() throws Exception {
        String room = room(); chat.join(room, peer.id());
        Map<String, byte[]> fixtures = new LinkedHashMap<>();
        fixtures.put("hello.TXT", "Xin chào\n".getBytes(StandardCharsets.UTF_8));
        fixtures.put("report.csv", "name,count\nAlice,2\n".getBytes(StandardCharsets.UTF_8));
        fixtures.put("bundle.zip", zip(Map.of("readme.txt", "hello".getBytes(StandardCharsets.UTF_8))));
        for (String extension : List.of("docx", "xlsx", "pptx")) fixtures.put("report." + extension, office(extension));
        String last = null;
        for (var entry : fixtures.entrySet()) {
            String id = upload(room, owner, entry.getKey(), entry.getValue(), 201).path("id").asText(); last = id;
            get("/api/uploads/" + id, peer, 403); get("/api/uploads/" + id, outsider, 403);
            var message = chat.send(room, owner.id(), "", UUID.randomUUID().toString(), id, List.of()).message();
            assertThat(message.attachment()).isNotNull();
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/uploads/" + id).header("Authorization", "Bearer " + peer.token()))
                .andExpect(status().isOk()).andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment;")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff")).andExpect(content().bytes(entry.getValue()));
            if (entry.getKey().endsWith("docx")) {
                assertThat(db.queryForObject("SELECT media_type FROM uploads WHERE id=?", String.class, id)).isEqualTo("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
                actions.change(owner.id(), message.id(), "delete", null, "", false);
                get("/api/uploads/" + id, peer, 403);
            }
        }
        call(HttpMethod.DELETE, "/api/admin/groups/" + room + "/members/" + peer.id(), admin, null, 200);
        get("/api/uploads/" + last, peer, 403);
        upload(room, outsider, "readme.txt", "hello".getBytes(StandardCharsets.UTF_8), 403);
    }
    @Test void rejectsSpoofedBinaryMalformedOfficeAndOversizedArchives() throws Exception {
        String room = room();
        upload(room, owner, "script.exe", new byte[]{77, 90, 0, 0}, 400);
        upload(room, owner, "binary.txt", new byte[]{0, 1, 2}, 400);
        upload(room, owner, "encoding.csv", new byte[]{(byte)0xFF, (byte)0xFE}, 400);
        upload(room, owner, "fake.zip", new byte[]{80, 75, 3, 4}, 400);
        upload(room, owner, "fake.docx", zip(Map.of("hello.txt", new byte[]{1})), 400);
        upload(room, owner, "wrong.xlsx", office("docx"), 400);
        upload(room, owner, "legacy.doc", new byte[]{1}, 400);
        upload(room, owner, "too-large.txt", new byte[5 * 1024 * 1024 + 1], 400);
        upload(room, owner, "macro.docx", zip(Map.of("word/vbaProject.bin", new byte[]{1})), 400);
        upload(room, owner, "traversal.zip", zip(Map.of("../outside.txt", new byte[]{1})), 400);
        upload(room, owner, "expanded.zip", zip(Map.of("huge.txt", new byte[26 * 1024 * 1024])), 400);
        upload(room, owner, "empty.txt", new byte[0], 400);
        byte[] validZip = zip(Map.of("hello.txt", "hello".getBytes(StandardCharsets.UTF_8)));
        upload(room, owner, "truncated.zip", Arrays.copyOf(validZip, validZip.length - 22), 400);
        String type = "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
        String external = "<!DOCTYPE document [<!ENTITY x SYSTEM 'file:///not-allowed'>]><document>&x;</document>";
        upload(room, owner, "external.docx", zip(Map.of("[Content_Types].xml", type.getBytes(StandardCharsets.UTF_8), "word/document.xml", external.getBytes(StandardCharsets.UTF_8))), 400);
    }
    private byte[] office(String extension) throws Exception {
        String part = switch (extension) { case "docx" -> "word/document.xml"; case "xlsx" -> "xl/workbook.xml"; default -> "ppt/presentation.xml"; };
        String type = switch (extension) {
            case "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
            case "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
            default -> "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
        };
        String contentTypes = "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/" + part + "\" ContentType=\"" + type + "\"/></Types>";
        return zip(Map.of("[Content_Types].xml", contentTypes.getBytes(StandardCharsets.UTF_8), part, "<document/>".getBytes(StandardCharsets.UTF_8)));
    }
    private byte[] zip(Map<String, byte[]> entries) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (var entry : entries.entrySet()) { zip.putNextEntry(new ZipEntry(entry.getKey())); zip.write(entry.getValue()); zip.closeEntry(); }
        }
        return bytes.toByteArray();
    }
}
