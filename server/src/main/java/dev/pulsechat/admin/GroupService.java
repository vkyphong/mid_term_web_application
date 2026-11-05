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
    public record Group(String id, String name, String description, boolean archived, int memberCount, Instant lastMessageAt,
            boolean requireApproval, int pendingRequests) {}
    public record GroupPage(List<Group> groups, int total, int page, int pageSize) {}
    public record Archive(Boolean archived) {}
    private final JdbcTemplate db;
    private final AdminService admin;
    private final ChatService chat;
    private final AuditLog audit;

    public GroupService(JdbcTemplate db, AdminService admin, ChatService chat, AuditLog audit) {
        this.db = db; this.admin = admin; this.chat = chat; this.audit = audit;
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
        var created = group(chat.createRoom(actor, input).id());
        audit.group(actor, "group.create", created.id(), created.description());
        return created;
    }
    public Group update(String actor, String id, CreateRoom input) {
        admin.requireAdmin(actor); lockGroup(id);
        var validated = ChatService.validateRoom(input);
        var before = group(id);
        db.update("UPDATE rooms SET name=?,name_key=?,description=? WHERE id=?",
            validated.name(), validated.name().toLowerCase(Locale.ROOT), validated.description(), id);
        if (!before.name().equals(validated.name()))
            audit.group(actor, "group.rename", id, before.name() + " → " + validated.name());
        else if (!java.util.Objects.equals(before.description(), validated.description()))
            audit.group(actor, "group.describe", id, validated.description());
        return group(id);
    }
    public Group archive(String actor, String id, Archive input) {
        admin.requireAdmin(actor); lockGroup(id);
        if (input == null || input.archived() == null) throw ChatService.field("archived", "Boolean required");
        if (db.update("UPDATE rooms SET archived=? WHERE id=? AND archived<>?", input.archived(), id, input.archived()) > 0)
            audit.group(actor, input.archived() ? "group.archive" : "group.restore", id, null);
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
        boolean already = isMember(id, target);
        chat.insertMember(id, target);
        if (!already) audit.group(actor, "group.member_add", id, audit.describeUser(target));
        return group(id);
    }
    public Group removeMember(String actor, String id, String user) {
        admin.requireAdmin(actor);
        if (user == null || user.isBlank() || user.length() > 36) throw ChatService.field("userId", "Employee ID required");
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockGroup(id);
        boolean was = isMember(id, user);
        chat.removeMember(id, user); // chuyển quyền nếu người bị xoá là trưởng nhóm
        if (was) audit.group(actor, "group.member_remove", id, audit.describeUser(user));
        return group(id);
    }
    /** Admin chỉ định trưởng nhóm / phó nhóm / thành viên thường. */
    public List<RoomMember> setMemberRole(String actor, String id, String user, SetRole input) {
        admin.requireAdmin(actor);
        if (user == null || user.isBlank() || user.length() > 36) throw ChatService.field("userId", "Employee ID required");
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockGroup(id);
        String before = memberRole(id, user);
        var members = chat.adminSetRole(id, user, input);
        if (before != null && !before.equals(input.role()))
            audit.group(actor, "group.member_role", id, audit.describeUser(user) + ": " + before + " → " + input.role());
        return members;
    }
    /** Admin bật / tắt chế độ phê duyệt thành viên mới. */
    public Group settings(String actor, String id, RoomSettings input) {
        admin.requireAdmin(actor); lockGroup(id);
        boolean before = group(id).requireApproval();
        chat.adminSetApproval(id, input);
        if (before != input.requireApproval()) audit.group(actor, input.requireApproval() ? "group.approval_on" : "group.approval_off", id, null);
        return group(id);
    }
    private boolean isMember(String room, String user) {
        return db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=? AND user_id=?", Integer.class, room, user) > 0;
    }
    private String memberRole(String room, String user) {
        return db.query("SELECT role FROM room_members WHERE room_id=? AND user_id=?", (rs, n) -> rs.getString(1), room, user)
            .stream().findFirst().orElse(null);
    }
    private void lockGroup(String id) {
        var types = db.query("SELECT type FROM rooms WHERE id=? FOR UPDATE", (rs, n) -> rs.getString(1), id);
        if (types.isEmpty() || !"channel".equals(types.getFirst())) throw notFound();
    }
    private Group group(String id) {
        var groups = db.query("SELECT r.*, (SELECT COUNT(*) FROM room_members m WHERE m.room_id=r.id) AS member_count, "
                + "(SELECT COUNT(*) FROM member_requests q WHERE q.room_id=r.id) AS pending_count FROM rooms r WHERE r.id=? AND r.type='channel'",
            (rs, n) -> new Group(rs.getString("id"), rs.getString("name"), rs.getString("description"), rs.getBoolean("archived"),
                rs.getInt("member_count"), rs.getTimestamp("last_message_at") == null ? null : rs.getTimestamp("last_message_at").toInstant(),
                rs.getBoolean("require_approval"), rs.getInt("pending_count")), id);
        if (groups.isEmpty()) throw notFound(); return groups.getFirst();
    }
    private static ApiException notFound() { return new ApiException(404, "invalid_payload", "not_found", "Group not found"); }
}
