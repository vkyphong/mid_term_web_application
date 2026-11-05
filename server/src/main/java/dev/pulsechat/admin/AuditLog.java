package dev.pulsechat.admin;

import dev.pulsechat.chat.ChatService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Nhật ký quản trị; ghi trong cùng transaction với thao tác nên thao tác lỗi thì không có dòng nhật ký. */
@Component
public class AuditLog {
    public static final int PAGE_SIZE = 20;
    public record Actor(String id, String displayName, String email) {}
    public record Entry(String id, Instant at, Actor actor, String action, String targetType, String targetId, String targetLabel, String detail) {}
    public record Page(List<Entry> entries, int total, int page, int pageSize) {}

    private final JdbcTemplate db;
    public AuditLog(JdbcTemplate db) { this.db = db; }

    public void user(String actor, String action, String userId, String detail) {
        String label = db.query("SELECT email FROM users WHERE id=?", (rs, n) -> rs.getString(1), userId).stream().findFirst().orElse(null);
        write(actor, action, "user", userId, label, detail);
    }
    public void group(String actor, String action, String roomId, String detail) {
        String label = db.query("SELECT name FROM rooms WHERE id=?", (rs, n) -> rs.getString(1), roomId).stream().findFirst().orElse(null);
        write(actor, action, "group", roomId, label, detail);
    }
    public void system(String actor, String action, String detail) { write(actor, action, "system", null, null, detail); }

    /** "Tên (email)" của một nhân viên, dùng trong phần chi tiết. */
    public String describeUser(String userId) {
        return db.query("SELECT display_name, email FROM users WHERE id=?", (rs, n) -> rs.getString(1) + " (" + rs.getString(2) + ")", userId)
            .stream().findFirst().orElse(userId);
    }

    private void write(String actor, String action, String type, String targetId, String label, String detail) {
        db.update("INSERT INTO admin_audit(id,actor_id,action,target_type,target_id,target_label,detail,created_at) VALUES (?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), actor, action, type, targetId, cut(label, 254), cut(detail, 500), Timestamp.from(Instant.now()));
    }

    public Page page(int page) {
        if (page < 0 || page > 100000) throw ChatService.field("page", "Invalid page");
        int total = db.queryForObject("SELECT COUNT(*) FROM admin_audit", Integer.class);
        var entries = db.query("SELECT a.*, u.display_name, u.email FROM admin_audit a JOIN users u ON u.id=a.actor_id "
                + "ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?",
            (rs, n) -> new Entry(rs.getString("id"), rs.getTimestamp("created_at").toInstant(),
                new Actor(rs.getString("actor_id"), rs.getString("display_name"), rs.getString("email")),
                rs.getString("action"), rs.getString("target_type"), rs.getString("target_id"), rs.getString("target_label"), rs.getString("detail")),
            PAGE_SIZE, page * PAGE_SIZE);
        return new Page(entries, total, page, PAGE_SIZE);
    }

    private static String cut(String value, int max) {
        return value == null || value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }
}
