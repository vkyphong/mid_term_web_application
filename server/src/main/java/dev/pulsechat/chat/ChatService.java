package dev.pulsechat.chat;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import dev.pulsechat.common.ApiException;
import static dev.pulsechat.chat.ChatDtos.*;

@Service
@Transactional
public class ChatService {
    private final JdbcTemplate db;
    public ChatService(JdbcTemplate db) { this.db = db; }
    private static final String MESSAGE_SELECT = "SELECT m.*, u.display_name FROM messages m JOIN users u ON u.id=m.sender_id ";
    private static final RowMapper<Message> MESSAGE = (rs, n) -> new Message(rs.getString("id"), rs.getString("room_id"),
        rs.getString("client_msg_id"), new Sender(rs.getString("sender_id"), rs.getString("display_name")),
        rs.getString("content"), rs.getTimestamp("created_at").toInstant());

    @Transactional(readOnly = true)
    public List<Room> listRooms(String user) {
        return db.query("SELECT id FROM rooms r WHERE type='channel' OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=?) ORDER BY name, id",
            (rs, n) -> rs.getString(1), user).stream().map(id -> room(id, user)).toList();
    }
    public Room createRoom(String user, CreateRoom input) {
        String name = input == null || input.name() == null ? "" : input.name().trim();
        if (name.length() < 2 || name.length() > 40) throw field("name", "Channel name must contain 2–40 characters");
        String description = input.description() == null ? null : input.description().trim();
        if (description != null && description.length() > 200) throw field("description", "Description must contain at most 200 characters");
        String id = UUID.randomUUID().toString();
        // The unique index arbitrates concurrent requests; the controller maps duplicate keys.
        db.update("INSERT INTO rooms(id,type,name,name_key,description) VALUES (?,'channel',?,?,?)", id, name, name.toLowerCase(Locale.ROOT), description);
        db.update("INSERT INTO room_members(room_id,user_id) VALUES (?,?)", id, user);
        return room(id, user);
    }
    @Transactional(readOnly = true)
    public List<UserSummary> searchUsers(String user, String search, int limit) {
        if (limit < 1 || limit > 20) throw field("limit", "Limit must be between 1 and 20");
        if (search == null || search.length() > 254) throw field("search", "Search must contain at most 254 characters");
        // LOCATE treats percent/underscore as literal search characters.
        String query = search.trim().toLowerCase(Locale.ROOT);
        return db.query("SELECT id,display_name,email FROM users WHERE enabled=true AND id<>? AND (LOCATE(?,LOWER(display_name))>0 OR LOCATE(?,LOWER(email))>0) ORDER BY display_name,id LIMIT ?",
            (rs, n) -> new UserSummary(rs.getString(1), rs.getString(2), rs.getString(3)), user, query, query, limit);
    }
    public Room openDm(String user, OpenDm input) {
        String peer = input == null ? null : input.userId();
        if (peer == null || peer.equals(user) || peer.length() > 36) throw field("userId", "Choose another employee");
        var pair = new ArrayList<>(List.of(user, peer)); Collections.sort(pair);
        // Lock both users in a stable order. Concurrent A→B/B→A transactions see one DM.
        for (String id : pair) {
            var enabled = db.query("SELECT enabled FROM users WHERE id=? FOR UPDATE", (rs, n) -> rs.getBoolean(1), id);
            if (enabled.isEmpty() || !enabled.getFirst()) throw field("userId", "Employee not found");
        }
        String key = String.join(":", pair);
        var existing = db.query("SELECT id FROM rooms WHERE dm_key=?", (rs, n) -> rs.getString(1), key);
        String id;
        if (existing.isEmpty()) {
            id = UUID.randomUUID().toString();
            db.update("INSERT INTO rooms(id,type,dm_key) VALUES (?,'dm',?)", id, key);
            for (String member : pair) db.update("INSERT INTO room_members(room_id,user_id) VALUES (?,?)", id, member);
        } else id = existing.getFirst();
        return room(id, user);
    }
    public Room join(String id, String user) {
        requireChannel(id);
        if (!member(id, user)) db.update("INSERT INTO room_members(room_id,user_id) VALUES (?,?)", id, user);
        return room(id, user);
    }
    public void leave(String id, String user) {
        requireChannel(id);
        db.update("DELETE FROM room_members WHERE room_id=? AND user_id=?", id, user);
    }
    public Delivery send(String room, String user, String content, String clientMsgId) {
        lockRoom(room); requireMember(room, user);
        if (content == null || content.trim().isEmpty() || content.trim().getBytes(StandardCharsets.UTF_8).length > 2048)
            throw field("content", "Message must contain 1–2048 UTF-8 bytes");
        if (clientMsgId == null || !clientMsgId.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))
            throw field("clientMsgId", "A UUID is required");
        var existing = db.query(MESSAGE_SELECT + "WHERE m.room_id=? AND m.sender_id=? AND m.client_msg_id=?", MESSAGE, room, user, clientMsgId);
        if (!existing.isEmpty()) return new Delivery(existing.getFirst(), List.of(), false);
        String id = UUID.randomUUID().toString(); Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        db.update("INSERT INTO messages(id,room_id,sender_id,client_msg_id,content,created_at) VALUES (?,?,?,?,?,?)",
            id, room, user, clientMsgId, content.trim(), Timestamp.from(now));
        db.update("UPDATE rooms SET last_message_at=? WHERE id=?", Timestamp.from(now), room);
        var message = db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, id);
        return new Delivery(message, db.query("SELECT user_id FROM room_members WHERE room_id=?", (rs, n) -> rs.getString(1), room), true);
    }
    @Transactional(readOnly = true)
    public MessagePage history(String room, String user, int limit, String before) {
        if (limit < 1 || limit > 100) throw field("limit", "Limit must be between 1 and 100");
        room(room, user); requireMember(room, user);
        String sql = MESSAGE_SELECT + "WHERE m.room_id=?";
        var args = new ArrayList<Object>(); args.add(room);
        if (before != null) {
            try {
                if (before.length() > 256) throw new IllegalArgumentException();
                String[] parts = new String(Base64.getUrlDecoder().decode(before), StandardCharsets.UTF_8).split("\\|", -1);
                if (parts.length != 3 || !parts[0].equals(room)) throw new IllegalArgumentException();
                Timestamp time = Timestamp.from(Instant.parse(parts[1])); UUID.fromString(parts[2]);
                sql += " AND (m.created_at<? OR (m.created_at=? AND m.id<?))";
                args.add(time); args.add(time); args.add(parts[2]);
            } catch (RuntimeException e) { throw field("before", "Invalid history cursor"); }
        }
        args.add(limit + 1);
        var messages = new ArrayList<>(db.query(sql + " ORDER BY m.created_at DESC,m.id DESC LIMIT ?", MESSAGE, args.toArray()));
        boolean more = messages.size() > limit;
        if (more) messages.removeLast();
        String cursor = null;
        if (more) {
            var oldest = messages.getLast();
            cursor = Base64.getUrlEncoder().withoutPadding().encodeToString((room + "|" + oldest.createdAt() + "|" + oldest.id()).getBytes(StandardCharsets.UTF_8));
        }
        Collections.reverse(messages); return new MessagePage(messages, cursor);
    }
    private void requireChannel(String id) {
        if (!"channel".equals(lockRoom(id))) throw forbidden();
    }
    private String lockRoom(String id) {
        var types = db.query("SELECT type FROM rooms WHERE id=? FOR UPDATE", (rs, n) -> rs.getString(1), id);
        if (types.isEmpty()) throw notFound(); return types.getFirst();
    }
    private boolean member(String room, String user) {
        return db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=? AND user_id=?", Integer.class, room, user) > 0;
    }
    private void requireMember(String room, String user) { if (!member(room, user)) throw forbidden(); }
    private Room room(String id, String user) {
        var rooms = db.query("SELECT * FROM rooms WHERE id=?", (rs, n) -> {
            boolean joined = member(id, user); String type = rs.getString("type");
            UserSummary peer = null;
            if (type.equals("dm")) {
                if (!joined) throw forbidden();
                peer = db.queryForObject("SELECT u.id,u.display_name,u.email FROM users u JOIN room_members m ON u.id=m.user_id WHERE m.room_id=? AND u.id<>?",
                    (row, i) -> new UserSummary(row.getString(1), row.getString(2), row.getString(3)), id, user);
            }
            return new Room(id, type, peer == null ? rs.getString("name") : peer.displayName(), rs.getString("description"),
                db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=?", Integer.class, id), joined, peer, instant(rs, "last_message_at"));
        }, id);
        if (rooms.isEmpty()) throw notFound(); return rooms.getFirst();
    }
    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column); return value == null ? null : value.toInstant();
    }
    public static ApiException field(String field, String message) {
        return new ApiException(400, "invalid_payload", "validation", "Invalid request", List.of(new ApiException.FieldIssue(field, message)));
    }
    private static ApiException forbidden() { return new ApiException(403, "forbidden", null, "Room membership required"); }
    private static ApiException notFound() { return new ApiException(404, "invalid_payload", "not_found", "Room not found"); }
}
