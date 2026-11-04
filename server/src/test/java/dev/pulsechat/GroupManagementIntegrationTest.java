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

    @Test void usersSetProfileAvatarsVisibleToEveryEmployee() throws Exception {
        Account me = account();
        var uploaded = mapper.readTree(mvc.perform(multipart("/api/me/avatar").file(new MockMultipartFile("file", "toi.png", "application/octet-stream", png()))
            .header("Authorization", "Bearer " + me.token())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String url = uploaded.path("avatarUrl").asText();
        assertThat(url).startsWith("/api/users/" + me.id() + "/avatar?v=");
        assertThat(get("/api/users/avatars", outsider, 200).path("avatars").findValuesAsText("userId")).contains(me.id());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url).header("Authorization", "Bearer " + outsider.token()))
            .andExpect(status().isOk()).andExpect(header().string("Content-Type", "image/png"));
        mvc.perform(multipart("/api/me/avatar").file(new MockMultipartFile("file", "a.pdf", "application/pdf", "%PDF-1.4".getBytes(StandardCharsets.UTF_8)))
            .header("Authorization", "Bearer " + me.token())).andExpect(status().isBadRequest());
        call(HttpMethod.DELETE, "/api/me/avatar", me, null, 200);
        assertThat(get("/api/users/avatars", outsider, 200).path("avatars").findValuesAsText("userId")).doesNotContain(me.id());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/users/" + me.id() + "/avatar")
            .header("Authorization", "Bearer " + outsider.token())).andExpect(status().isNotFound());
    }

    @Test void usersReadAndUpdateTheirOwnProfile() throws Exception {
        Account me = account();
        var profile = get("/api/me/profile", me, 200);
        assertThat(profile.path("displayName").asText()).isEqualTo("Group Employee");
        assertThat(profile.path("gender").isNull()).isTrue();
        var updated = call(HttpMethod.PUT, "/api/me/profile", me,
            Map.of("displayName", "  Võ Thành Đạt ", "gender", "male", "birthDate", "2006-05-18", "phone", "0901 234 567"), 200);
        assertThat(updated.path("displayName").asText()).isEqualTo("Võ Thành Đạt");
        assertThat(updated.path("birthDate").asText()).isEqualTo("2006-05-18");
        assertThat(updated.path("phone").asText()).isEqualTo("0901 234 567");
        assertThat(get("/api/auth/me", me, 200).path("displayName").asText()).isEqualTo("Võ Thành Đạt");
        // Xoá thông tin tuỳ chọn bằng chuỗi rỗng.
        updated = call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Võ Thành Đạt", "gender", "", "birthDate", "", "phone", ""), 200);
        assertThat(updated.path("gender").isNull()).isTrue();
        assertThat(updated.path("phone").isNull()).isTrue();
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "x"), 400);
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Hợp lệ", "gender", "robot"), 400);
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Hợp lệ", "birthDate", "2999-01-01"), 400);
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Hợp lệ", "phone", "gọi tôi"), 400);
    }

    @Test void privateProfilesHidePersonalInfoFromOthers() throws Exception {
        Account me = account(), other = account();
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Riêng Tư", "gender", "female", "birthDate", "2000-01-02", "phone", "0901234567"), 200);
        var hidden = get("/api/users/" + me.id() + "/profile", other, 200);
        assertThat(hidden.path("profilePublic").asBoolean()).isFalse();
        assertThat(hidden.path("displayName").asText()).isEqualTo("Riêng Tư");
        assertThat(hidden.path("gender").isNull()).isTrue();
        assertThat(hidden.path("phone").isNull()).isTrue();
        assertThat(get("/api/me/profile", me, 200).path("phone").asText()).isEqualTo("0901234567");
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Riêng Tư", "gender", "female", "birthDate", "2000-01-02", "phone", "0901234567", "profilePublic", true), 200);
        var shown = get("/api/users/" + me.id() + "/profile", other, 200);
        assertThat(shown.path("profilePublic").asBoolean()).isTrue();
        assertThat(shown.path("gender").asText()).isEqualTo("female");
        assertThat(shown.path("birthDate").asText()).isEqualTo("2000-01-02");
        // Không gửi profilePublic thì giữ nguyên.
        call(HttpMethod.PUT, "/api/me/profile", me, Map.of("displayName", "Riêng Tư"), 200);
        assertThat(get("/api/users/" + me.id() + "/profile", other, 200).path("profilePublic").asBoolean()).isTrue();
        get("/api/users/" + UUID.randomUUID() + "/profile", other, 404);
    }

    @Test void pollVotesLeaveActivityLinesAndOnlyCreatorOrLeadersClose() throws Exception {
        Account boss = account(), deputy = account(), voter = account(), maker = account();
        String room = chat.createRoom(boss.id(), new ChatDtos.CreateRoom("Polls-" + UUID.randomUUID().toString().substring(0, 20), null)).id();
        for (var a : List.of(deputy, voter, maker)) post("/api/rooms/" + room + "/members", boss, Map.of("userId", a.id()), 200);
        call(HttpMethod.PUT, "/api/rooms/" + room + "/members/" + deputy.id() + "/role", boss, Map.of("role", "deputy"), 200);
        var poll = post("/api/rooms/" + room + "/polls", maker, Map.of("question", "Họp lúc mấy giờ?", "options", List.of("20h", "21h")), 201).path("poll");
        String pollId = poll.path("id").asText(), h20 = poll.path("options").get(0).path("id").asText(), h21 = poll.path("options").get(1).path("id").asText();
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", voter, Map.of("optionIds", List.of(h20)), 200);
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", voter, Map.of("optionIds", List.of(h20)), 200); // không đổi → không thêm dòng
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", voter, Map.of("optionIds", List.of(h21)), 200);
        // Thành viên thường (không phải người tạo) không khoá được.
        post("/api/polls/" + pollId + "/close", voter, null, 403);
        var closed = post("/api/polls/" + pollId + "/close", deputy, null, 200);
        assertThat(closed.path("poll").path("closedBy").asText()).isEqualTo(deputy.id());
        assertThat(call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", voter, Map.of("optionIds", List.of(h20)), 409).path("error").path("reason").asText()).isEqualTo("poll_closed");
        var history = get("/api/rooms/" + room + "/messages", boss, 200).path("messages");
        var activities = new ArrayList<String>();
        for (JsonNode m : history) if (!m.path("activity").isMissingNode() && !m.path("activity").isNull()) {
            activities.add(m.path("activity").path("type").asText());
            assertThat(m.path("activity").path("pollMessageId").asText()).isEqualTo(history.get(0).path("id").asText());
            assertThat(m.path("content").asText()).isEqualTo("Họp lúc mấy giờ?");
        }
        assertThat(activities).containsExactly("vote", "change", "close");
        // Dòng hoạt động không tính tin chưa đọc, không tìm thấy khi tìm kiếm, không sửa được.
        assertThat(listed(room, boss).unreadCount()).isEqualTo(1); // chỉ tin bình chọn
        assertThat(get("/api/rooms/" + room + "/search?q=h%E1%BB%8Dp", boss, 200).path("messages")).hasSize(1);
        String line = history.get(1).path("id").asText();
        assertThatThrownBy(() -> actions.change(voter.id(), line, "delete", null, "", false)).isInstanceOf(ApiException.class);
        // Trưởng nhóm cũng khoá được (bình chọn khác), người tạo cũng vậy.
        var second = post("/api/rooms/" + room + "/polls", maker, Map.of("question", "Lần hai", "options", List.of("A", "B")), 201).path("poll").path("id").asText();
        post("/api/polls/" + second + "/close", maker, null, 200);
        var third = post("/api/rooms/" + room + "/polls", maker, Map.of("question", "Lần ba", "options", List.of("A", "B")), 201).path("poll").path("id").asText();
        post("/api/polls/" + third + "/close", boss, null, 200);

        // Mở lại / khoá lại thoải mái, nhưng chỉ người tạo, trưởng nhóm, phó nhóm.
        post("/api/polls/" + pollId + "/reopen", voter, null, 403);
        var reopened = post("/api/polls/" + pollId + "/reopen", maker, null, 200);
        assertThat(reopened.path("poll").path("closedAt").asText(null)).isNull(); // null hoặc không có trường
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", voter, Map.of("optionIds", List.of(h20)), 200);
        post("/api/polls/" + pollId + "/close", boss, null, 200);
        post("/api/polls/" + pollId + "/close", boss, null, 200); // khoá lại lần nữa: không thêm dòng
        post("/api/polls/" + pollId + "/reopen", deputy, null, 200);
        var types = new ArrayList<String>();
        for (JsonNode m : get("/api/rooms/" + room + "/messages", boss, 200).path("messages"))
            if (m.path("activity").path("pollId").asText().equals(pollId)) types.add(m.path("activity").path("type").asText());
        assertThat(types).containsExactly("vote", "change", "close", "reopen", "change", "close", "reopen");
    }

    @Test void ownerRequiresApprovalForMembersAddedByRegularMembers() throws Exception {
        Account boss = account(), deputy = account(), regular = account(), guest = account(), guest2 = account();
        String room = chat.createRoom(boss.id(), new ChatDtos.CreateRoom("Approve-" + UUID.randomUUID().toString().substring(0, 20), null)).id();
        String members = "/api/rooms/" + room + "/members";
        post(members, boss, Map.of("userId", deputy.id()), 200);
        post(members, boss, Map.of("userId", regular.id()), 200);
        call(HttpMethod.PUT, members + "/" + deputy.id() + "/role", boss, Map.of("role", "deputy"), 200);
        // Chỉ trưởng nhóm bật được phê duyệt.
        call(HttpMethod.PATCH, "/api/rooms/" + room + "/settings", deputy, Map.of("requireApproval", true), 403);
        assertThat(call(HttpMethod.PATCH, "/api/rooms/" + room + "/settings", boss, Map.of("requireApproval", true), 200).path("requireApproval").asBoolean()).isTrue();

        // Thành viên thường thêm người → yêu cầu chờ duyệt, người đó chưa vào nhóm; gửi lại không tạo trùng.
        var pending = post(members, regular, Map.of("userId", guest.id()), 202);
        assertThat(pending.path("pending").asBoolean()).isTrue();
        assertThat(pending.path("request").path("requestedBy").path("id").asText()).isEqualTo(regular.id());
        post(members, regular, Map.of("userId", guest.id()), 202);
        post(members, regular, Map.of("userId", guest2.id()), 202);
        assertThat(listed(room, guest).joined()).isFalse();
        assertThat(listed(room, boss).pendingRequests()).isEqualTo(2);
        assertThat(listed(room, regular).pendingRequests()).isZero(); // chỉ trưởng / phó nhóm thấy
        get("/api/rooms/" + room + "/requests", regular, 403);
        var requests = get("/api/rooms/" + room + "/requests", deputy, 200).path("requests");
        assertThat(requests).hasSize(2);

        // Phó nhóm duyệt một, trưởng nhóm từ chối một.
        String guestRequest = requests.get(0).path("id").asText(), guest2Request = requests.get(1).path("id").asText();
        assertThat(post("/api/rooms/" + room + "/requests/" + guestRequest + "/approve", deputy, null, 200).path("requests")).hasSize(1);
        assertThat(listed(room, guest).joined()).isTrue();
        post("/api/rooms/" + room + "/requests/" + guest2Request + "/reject", boss, null, 200);
        assertThat(listed(room, guest2).joined()).isFalse();
        assertThat(listed(room, boss).pendingRequests()).isZero();
        post("/api/rooms/" + room + "/requests/" + guest2Request + "/approve", boss, null, 404);

        // Trưởng / phó nhóm vẫn thêm thẳng; tắt phê duyệt thì thành viên thường lại thêm thẳng.
        post(members, deputy, Map.of("userId", guest2.id()), 200);
        Account guest3 = account();
        call(HttpMethod.PATCH, "/api/rooms/" + room + "/settings", boss, Map.of("requireApproval", false), 200);
        post(members, regular, Map.of("userId", guest3.id()), 200);
        assertThat(listed(room, guest3).joined()).isTrue();
    }

    @Test void roomMediaListsImagesFilesAndLinksNewestFirst() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        String image = upload(room, owner, "anh.png", png(), 201).path("id").asText();
        String text = upload(room, peer, "ghi-chu.txt", "Ghi chú".getBytes(StandardCharsets.UTF_8), 201).path("id").asText();
        chat.send(room, owner.id(), "", UUID.randomUUID().toString(), image, List.of());
        chat.send(room, peer.id(), "file đây", UUID.randomUUID().toString(), text, List.of());
        chat.send(room, owner.id(), "Xem https://example.com/a và http://docs.dqgm.dev/b.", UUID.randomUUID().toString());
        var deleted = chat.send(room, owner.id(), "link cũ https://old.example.com", UUID.randomUUID().toString()).message();
        actions.change(owner.id(), deleted.id(), "delete", null, "", false);
        chat.send(room, peer.id(), "https://example.com/c", UUID.randomUUID().toString());

        var images = get("/api/rooms/" + room + "/media?kind=image", peer, 200).path("items");
        assertThat(images).hasSize(1);
        assertThat(images.get(0).path("attachment").path("filename").asText()).isEqualTo("anh.png");
        var files = get("/api/rooms/" + room + "/media?kind=file", peer, 200).path("items");
        assertThat(files.findValuesAsText("filename")).containsExactly("ghi-chu.txt");
        assertThat(files.get(0).path("sender").path("id").asText()).isEqualTo(peer.id());
        var links = get("/api/rooms/" + room + "/media?kind=link", owner, 200);
        assertThat(links.path("items").findValuesAsText("url")).containsExactly("https://example.com/c", "https://example.com/a", "http://docs.dqgm.dev/b");
        // Phân trang: 1 link mỗi trang theo tin.
        var first = get("/api/rooms/" + room + "/media?kind=link&limit=1", owner, 200);
        assertThat(first.path("items").findValuesAsText("url")).containsExactly("https://example.com/c");
        var second = get("/api/rooms/" + room + "/media?kind=link&limit=1&before=" + first.path("nextCursor").asText(), owner, 200);
        assertThat(second.path("items").findValuesAsText("url")).containsExactly("https://example.com/a", "http://docs.dqgm.dev/b");
        get("/api/rooms/" + room + "/media?kind=image", outsider, 403);
        get("/api/rooms/" + room + "/media?kind=video", owner, 400);
    }

    @Test void replyPinHideAndForwardMessages() throws Exception {
        String room = room(), other = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        post("/api/rooms/" + other + "/members", owner, Map.of("userId", peer.id()), 200);
        // Trả lời: tin mới mang trích tin gốc; tin ở phòng khác không trả lời được.
        var original = chat.send(room, owner.id(), "Họp lúc 9h nhé", UUID.randomUUID().toString()).message();
        var reply = chat.send(room, peer.id(), "Ok anh", UUID.randomUUID().toString(), null, List.of(), original.id()).message();
        assertThat(reply.replyTo().id()).isEqualTo(original.id());
        assertThat(reply.replyTo().content()).isEqualTo("Họp lúc 9h nhé");
        assertThat(reply.replyTo().sender().id()).isEqualTo(owner.id());
        var elsewhere = chat.send(other, owner.id(), "phòng khác", UUID.randomUUID().toString()).message();
        assertThatThrownBy(() -> chat.send(room, peer.id(), "sai", UUID.randomUUID().toString(), null, List.of(), elsewhere.id())).isInstanceOf(ApiException.class);

        // Ghim / bỏ ghim.
        assertThat(call(HttpMethod.PUT, "/api/messages/" + original.id() + "/pin", peer, Map.of("pinned", true), 200).path("pinnedBy").asText()).isEqualTo(peer.id());
        assertThat(get("/api/rooms/" + room + "/pins", owner, 200).path("messages").findValuesAsText("content")).containsExactly("Họp lúc 9h nhé");
        call(HttpMethod.PUT, "/api/messages/" + original.id() + "/pin", outsider, Map.of("pinned", true), 403);
        call(HttpMethod.PUT, "/api/messages/" + original.id() + "/pin", owner, Map.of("pinned", false), 200);
        assertThat(get("/api/rooms/" + room + "/pins", owner, 200).path("messages")).isEmpty();

        // Xoá chỉ ở phía tôi: người khác vẫn thấy.
        post("/api/messages/" + reply.id() + "/hide", owner, null, 200);
        assertThat(get("/api/rooms/" + room + "/messages", owner, 200).path("messages").findValuesAsText("id")).doesNotContain(reply.id());
        assertThat(get("/api/rooms/" + room + "/messages", peer, 200).path("messages").findValuesAsText("id")).contains(reply.id());

        // Chuyển tiếp ảnh sang phòng khác kèm lời nhắn: file được sao chép, tải được ở phòng đích.
        String image = upload(room, owner, "so-do.png", png(), 201).path("id").asText();
        var withImage = chat.send(room, owner.id(), "", UUID.randomUUID().toString(), image, List.of()).message();
        assertThat(post("/api/messages/" + withImage.id() + "/forward", peer, Map.of("roomIds", List.of(other), "note", "Xem sơ đồ"), 200).path("forwarded").asInt()).isEqualTo(1);
        var otherHistory = get("/api/rooms/" + other + "/messages", owner, 200).path("messages");
        var forwarded = otherHistory.get(otherHistory.size() - 2);
        assertThat(forwarded.path("sender").path("id").asText()).isEqualTo(peer.id());
        assertThat(forwarded.path("attachment").path("filename").asText()).isEqualTo("so-do.png");
        assertThat(forwarded.path("attachment").path("id").asText()).isNotEqualTo(image);
        assertThat(otherHistory.get(otherHistory.size() - 1).path("content").asText()).isEqualTo("Xem sơ đồ");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(forwarded.path("attachment").path("url").asText())
            .header("Authorization", "Bearer " + owner.token())).andExpect(status().isOk());
        // Chuyển tiếp sang phòng mình không ở → 403; không chọn phòng → 400.
        String foreign = chat.createRoom(outsider.id(), new ChatDtos.CreateRoom("Fwd-" + UUID.randomUUID().toString().substring(0, 20), null)).id();
        post("/api/messages/" + original.id() + "/forward", peer, Map.of("roomIds", List.of(foreign)), 403);
        post("/api/messages/" + original.id() + "/forward", peer, Map.of("roomIds", List.of()), 400);
    }

    @Test void creatorOwnsChannelAndAppointsUpToFiveDeputies() throws Exception {
        Account boss = account();
        String room = chat.createRoom(boss.id(), new ChatDtos.CreateRoom("Roles-" + UUID.randomUUID().toString().substring(0, 20), null)).id();
        var people = new ArrayList<Account>();
        for (int i = 0; i < 6; i++) { var a = account(); people.add(a); post("/api/rooms/" + room + "/members", boss, Map.of("userId", a.id()), 200); }
        assertThat(listed(room, boss).myRole()).isEqualTo("owner");
        assertThat(listed(room, people.getFirst()).myRole()).isEqualTo("member");
        String path = "/api/rooms/" + room + "/members/";
        for (int i = 0; i < 5; i++) call(HttpMethod.PUT, path + people.get(i).id() + "/role", boss, Map.of("role", "deputy"), 200);
        assertThat(call(HttpMethod.PUT, path + people.get(5).id() + "/role", boss, Map.of("role", "deputy"), 409).path("error").path("reason").asText()).isEqualTo("deputy_limit");
        // Bổ nhiệm lại người đã là phó nhóm không tính thêm.
        call(HttpMethod.PUT, path + people.getFirst().id() + "/role", boss, Map.of("role", "deputy"), 200);
        call(HttpMethod.PUT, path + people.get(5).id() + "/role", people.getFirst(), Map.of("role", "deputy"), 403);
        call(HttpMethod.PUT, path + boss.id() + "/role", boss, Map.of("role", "member"), 400);
        call(HttpMethod.PUT, path + outsider.id() + "/role", boss, Map.of("role", "deputy"), 400);
        var members = get("/api/rooms/" + room + "/members", boss, 200).path("members");
        assertThat(members.get(0).path("id").asText()).isEqualTo(boss.id());
        assertThat(members.get(0).path("memberRole").asText()).isEqualTo("owner");
        assertThat(members.findValuesAsText("memberRole").stream().filter("deputy"::equals).count()).isEqualTo(5);
        call(HttpMethod.PUT, path + people.get(1).id() + "/role", boss, Map.of("role", "member"), 200);
        // Trưởng nhóm rời đi → phó nhóm vào sớm nhất lên làm trưởng nhóm.
        chat.leave(room, boss.id());
        assertThat(listed(room, people.getFirst()).myRole()).isEqualTo("owner");
    }

    @Test void searchFindsMatchingMessagesNewestFirstForMembersOnly() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        chat.send(room, owner.id(), "Báo cáo quý 1 đã xong", UUID.randomUUID().toString());
        chat.send(room, peer.id(), "không liên quan", UUID.randomUUID().toString());
        chat.send(room, owner.id(), "Gửi BÁO CÁO quý 2", UUID.randomUUID().toString());
        var deleted = chat.send(room, owner.id(), "báo cáo cũ", UUID.randomUUID().toString()).message();
        actions.change(owner.id(), deleted.id(), "delete", null, "", false);
        chat.send(room, owner.id(), "giảm 50% phí", UUID.randomUUID().toString());
        var page = get("/api/rooms/" + room + "/search?q=b%C3%A1o%20c%C3%A1o&limit=1", peer, 200);
        assertThat(page.path("messages").findValuesAsText("content")).containsExactly("Gửi BÁO CÁO quý 2");
        var next = get("/api/rooms/" + room + "/search?q=b%C3%A1o%20c%C3%A1o&limit=1&before=" + page.path("nextCursor").asText(), peer, 200);
        assertThat(next.path("messages").findValuesAsText("content")).containsExactly("Báo cáo quý 1 đã xong");
        assertThat(next.path("nextCursor").isNull()).isTrue();
        // % là ký tự thường, không phải wildcard.
        assertThat(get("/api/rooms/" + room + "/search?q=50%25", peer, 200).path("messages")).hasSize(1);
        get("/api/rooms/" + room + "/search?q=b%C3%A1o", outsider, 403);
        get("/api/rooms/" + room + "/search?q=", peer, 400);
    }

    @Test void pollsAreMessagesMembersVoteOnRealtime() throws Exception {
        String room = room();
        post("/api/rooms/" + room + "/members", owner, Map.of("userId", peer.id()), 200);
        var created = post("/api/rooms/" + room + "/polls", owner,
            Map.of("question", "Ăn trưa ở đâu?", "options", List.of(" Cơm ", "Phở", "", "Bún")), 201);
        assertThat(created.path("content").asText()).isEqualTo("📊 Ăn trưa ở đâu?");
        var poll = created.path("poll");
        assertThat(poll.path("options").findValuesAsText("label")).containsExactly("Cơm", "Phở", "Bún");
        assertThat(poll.path("multiple").asBoolean()).isTrue();
        String pollId = poll.path("id").asText();
        String com = poll.path("options").get(0).path("id").asText(), pho = poll.path("options").get(1).path("id").asText();
        var voted = call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", peer, Map.of("optionIds", List.of(com, pho)), 200);
        assertThat(mapper.convertValue(voted.path("poll").path("options").get(0).path("voters"), List.class)).containsExactly(peer.id());
        // Đổi lựa chọn: thay toàn bộ, không cộng dồn.
        voted = call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", peer, Map.of("optionIds", List.of(pho)), 200);
        assertThat(voted.path("poll").path("options").get(0).path("voters")).isEmpty();
        assertThat(voted.path("poll").path("options").get(1).path("voters")).hasSize(1);
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", outsider, Map.of("optionIds", List.of(pho)), 403);
        call(HttpMethod.PUT, "/api/polls/" + pollId + "/votes", peer, Map.of("optionIds", List.of("khong-co")), 400);
        // Lịch sử trả lại bình chọn kèm phiếu.
        var history = get("/api/rooms/" + room + "/messages", owner, 200).path("messages");
        // Sau tin bình chọn là các dòng hoạt động "đã bình chọn / đổi lựa chọn".
        assertThat(history.findValuesAsText("id")).isNotEmpty();
        assertThat(history.get(0).path("poll").path("id").asText()).isEqualTo(pollId);
        assertThat(history.get(0).path("poll").path("options").get(1).path("voters")).hasSize(1);
        // Một lựa chọn duy nhất khi tắt chọn nhiều.
        var single = post("/api/rooms/" + room + "/polls", owner, Map.of("question", "Chọn một", "options", List.of("A", "B"), "multiple", false), 201).path("poll");
        call(HttpMethod.PUT, "/api/polls/" + single.path("id").asText() + "/votes", peer,
            Map.of("optionIds", List.of(single.path("options").get(0).path("id").asText(), single.path("options").get(1).path("id").asText())), 400);
        post("/api/rooms/" + room + "/polls", owner, Map.of("question", "Thiếu", "options", List.of("A")), 400);
        post("/api/rooms/" + room + "/polls", owner, Map.of("question", "Trùng", "options", List.of("A", "a")), 400);
        post("/api/rooms/" + room + "/polls", outsider, Map.of("question", "Ngoài", "options", List.of("A", "B")), 403);
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
