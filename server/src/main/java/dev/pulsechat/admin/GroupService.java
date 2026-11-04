package dev.pulsechat.admin;

import dev.pulsechat.chat.ChatDtos.*;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class GroupService {
    public record Group(String id, String name, String description, boolean archived, int memberCount, Instant lastMessageAt) {}
    public record GroupPage(List<Group> groups, int total, int page, int pageSize) {}
    public record Archive(Boolean archived) {}
    private final JdbcTemplate db;
    private final AdminService admin;
    private final ChatService chat;

    public GroupService(JdbcTemplate db, AdminService admin, ChatService chat) {
        this.db = db; this.admin = admin; this.chat = chat;
    }
    @Transactional(readOnly = true)
    public GroupPage list(String actor, String search, Boolean archived, int page) {
        admin.requireAdmin(actor);
        if (search == null || search.length() > 254 || page < 0 || page > 100000) throw ChatService.field("search", "Invalid search or page");
        String query = search.trim().toLowerCase(Locale.ROOT);
        String where = " WHERE r.type='channel' AND LOCATE(?,LOWER(r.name))>0" + (archived == null ? "" : " AND r.archived=" + (archived ? "true" : "false"));
        int total = db.queryForObject("SELECT COUNT(*) FROM rooms r" + where, Integer.class, query);
        var groups = db.query("SELECT r.id FROM rooms r" + where + " ORDER BY r.name,r.id LIMIT 20 OFFSET ?",
            (rs, n) -> rs.getString(1), query, page * 20).stream().map(this::group).toList();
        return new GroupPage(groups, total, page, 20);
    }
    @Transactional(readOnly = true)
    public Group detail(String actor, String id) { admin.requireAdmin(actor); return group(id); }
    public Group create(String actor, CreateRoom input) {
        admin.requireAdmin(actor);
        return group(chat.createRoom(actor, input).id());
    }
    public Group update(String actor, String id, CreateRoom input) {
        admin.requireAdmin(actor); lockGroup(id);
        var validated = ChatService.validateRoom(input);
        db.update("UPDATE rooms SET name=?,name_key=?,description=? WHERE id=?",
            validated.name(), validated.name().toLowerCase(Locale.ROOT), validated.description(), id);
        return group(id);
    }
    public Group archive(String actor, String id, Archive input) {
        admin.requireAdmin(actor); lockGroup(id);
        if (input == null || input.archived() == null) throw ChatService.field("archived", "Boolean required");
        db.update("UPDATE rooms SET archived=? WHERE id=?", input.archived(), id);
        return group(id);
    }
    @Transactional(readOnly = true)
    public List<RoomMember> members(String actor, String id) {
        admin.requireAdmin(actor); group(id); return chat.memberList(id);
    }
    public Group addMember(String actor, String id, AddMember input) {
        admin.requireAdmin(actor);
        String target = input == null ? null : input.userId();
        // User before room, matching join/send and avoiding a room→user lock inversion.
        chat.lockEnabledUser(target); lockGroup(id); chat.requireWritable(id);
        chat.insertMember(id, target); return group(id);
    }
    public Group removeMember(String actor, String id, String user) {
        admin.requireAdmin(actor);
        if (user == null || user.isBlank() || user.length() > 36) throw ChatService.field("userId", "Employee ID required");
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockGroup(id);
        chat.removeMember(id, user); // chuyển quyền nếu người bị xoá là trưởng nhóm
        return group(id);
    }
    private void lockGroup(String id) {
        var types = db.query("SELECT type FROM rooms WHERE id=? FOR UPDATE", (rs, n) -> rs.getString(1), id);
        if (types.isEmpty() || !"channel".equals(types.getFirst())) throw notFound();
    }
    private Group group(String id) {
        var groups = db.query("SELECT r.*, (SELECT COUNT(*) FROM room_members m WHERE m.room_id=r.id) AS member_count FROM rooms r WHERE r.id=? AND r.type='channel'",
            (rs, n) -> new Group(rs.getString("id"), rs.getString("name"), rs.getString("description"), rs.getBoolean("archived"),
                rs.getInt("member_count"), rs.getTimestamp("last_message_at") == null ? null : rs.getTimestamp("last_message_at").toInstant()), id);
        if (groups.isEmpty()) throw notFound(); return groups.getFirst();
    }
    private static ApiException notFound() { return new ApiException(404, "invalid_payload", "not_found", "Group not found"); }
}
