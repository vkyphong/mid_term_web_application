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
    private final dev.pulsechat.notification.NotificationService notifications;
    private final dev.pulsechat.realtime.RealtimeEvents events;
    public ChatService(JdbcTemplate db, dev.pulsechat.notification.NotificationService notifications, dev.pulsechat.realtime.RealtimeEvents events) {
        this.db = db; this.notifications = notifications; this.events = events;
    }
    private static final String MESSAGE_SELECT = "SELECT m.*, u.display_name FROM messages m JOIN users u ON u.id=m.sender_id ";
    private final RowMapper<Message> MESSAGE = (rs, n) -> new Message(rs.getString("id"), rs.getString("room_id"),
        rs.getString("client_msg_id"), new Sender(rs.getString("sender_id"), rs.getString("display_name")),
        rs.getString("content"), rs.getTimestamp("created_at").toInstant(), instant(rs,"edited_at"), instant(rs,"deleted_at"),
        attachment(rs.getString("id")), receipts(rs.getString("id")), reactions(rs.getString("id")), poll(rs.getString("id")),
        activity(rs));

    @Transactional(readOnly = true)
    public List<Room> listRooms(String user) {
        return db.query("SELECT id FROM rooms r WHERE type='channel' OR EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.user_id=?) ORDER BY name, id",
            (rs, n) -> rs.getString(1), user).stream().map(id -> room(id, user)).toList();
    }
    public Room createRoom(String user, CreateRoom input) {
        input = validateRoom(input);
        String name = input.name();
        String description = input.description();
        String id = UUID.randomUUID().toString();
        // The unique index arbitrates concurrent requests; the controller maps duplicate keys.
        db.update("INSERT INTO rooms(id,type,name,name_key,description) VALUES (?,'channel',?,?,?)", id, name, name.toLowerCase(Locale.ROOT), description);
        // Người tạo kênh là trưởng nhóm.
        db.update("INSERT INTO room_members(room_id,user_id,role,joined_at) VALUES (?,?,'owner',?)", id, user, now());
        return room(id, user);
    }
    private static Timestamp now() { return Timestamp.from(Instant.now().truncatedTo(ChronoUnit.MICROS)); }
    public static CreateRoom validateRoom(CreateRoom input) {
        String name = input == null || input.name() == null ? "" : input.name().trim();
        if (name.length() < 2 || name.length() > 40) throw field("name", "Channel name must contain 2–40 characters");
        String description = input.description() == null ? null : input.description().trim();
        if (description != null && description.length() > 200) throw field("description", "Description must contain at most 200 characters");
        return new CreateRoom(name, description);
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
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockRoom(id);
        requireChannel(id);
        requireWritable(id);
        if (!member(id, user)) db.update("INSERT INTO room_members(room_id,user_id,joined_at) VALUES (?,?,?)", id, user, now());
        return room(id, user);
    }
    public void leave(String id, String user) {
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockRoom(id);
        requireChannel(id);
        removeMember(id, user);
    }
    /** Xoá thành viên; nếu là trưởng nhóm thì chuyển quyền cho phó nhóm vào sớm nhất, không có thì thành viên vào sớm nhất. */
    public void removeMember(String room, String user) {
        boolean wasOwner = "owner".equals(role(room, user));
        db.update("DELETE FROM room_members WHERE room_id=? AND user_id=?", room, user);
        if (!wasOwner) return;
        db.query("SELECT user_id FROM room_members WHERE room_id=? ORDER BY CASE WHEN role='deputy' THEN 0 ELSE 1 END, "
                + "CASE WHEN joined_at IS NULL THEN 1 ELSE 0 END, joined_at, user_id LIMIT 1", (rs, n) -> rs.getString(1), room)
            .forEach(next -> db.update("UPDATE room_members SET role='owner' WHERE room_id=? AND user_id=?", room, next));
        broadcastRoom(room);
    }
    private String role(String room, String user) {
        return db.query("SELECT role FROM room_members WHERE room_id=? AND user_id=?", (rs, n) -> rs.getString(1), room, user)
            .stream().findFirst().orElse(null);
    }
    static final int MAX_DEPUTIES = 5;
    /** Trưởng nhóm bổ nhiệm / bỏ phó nhóm (tối đa 5). */
    public List<RoomMember> setRole(String room, String actor, String target, SetRole input) {
        String role = input == null ? null : input.role();
        if (!"deputy".equals(role) && !"member".equals(role)) throw field("role", "Role must be deputy or member");
        requireChannel(room); requireMember(room, actor); requireWritable(room);
        if (!"owner".equals(role(room, actor))) throw forbidden();
        String current = role(room, target);
        if (current == null) throw field("userId", "Employee is not a member of this channel");
        if (current.equals("owner")) throw field("userId", "The owner's role cannot be changed");
        if (role.equals("deputy") && !current.equals("deputy")
                && db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=? AND role='deputy'", Integer.class, room) >= MAX_DEPUTIES)
            throw new ApiException(409, "invalid_payload", "deputy_limit", "A channel has at most " + MAX_DEPUTIES + " deputies");
        db.update("UPDATE room_members SET role=? WHERE room_id=? AND user_id=?", role, room, target);
        broadcastRoom(room);
        return memberList(room);
    }
    public Delivery send(String room, String user, String content, String clientMsgId) {
        return send(room,user,content,clientMsgId,null,List.of());
    }
    public Delivery send(String room, String user, String content, String clientMsgId, String uploadId, List<String> mentions) {
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockRoom(room); requireMember(room, user);
        requireWritable(room);
        if (content == null || (content.trim().isEmpty() && uploadId == null) || content.trim().getBytes(StandardCharsets.UTF_8).length > 2048)
            throw field("content", "Message must contain 1–2048 UTF-8 bytes");
        if (clientMsgId == null || !clientMsgId.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))
            throw field("clientMsgId", "A UUID is required");
        var existing = db.query(MESSAGE_SELECT + "WHERE m.sender_id=? AND m.client_msg_id=?", MESSAGE, user, clientMsgId);
        if (!existing.isEmpty()) {
            if (!existing.getFirst().roomId().equals(room)) throw field("clientMsgId", "Retry key already belongs to another room");
            return new Delivery(existing.getFirst(), List.of(), false);
        }
        if (mentions.size()>20 || new HashSet<>(mentions).size()!=mentions.size()) throw field("mentions", "At most 20 distinct member IDs");
        for (String mentioned : mentions) requireMember(room,mentioned);
        String id = UUID.randomUUID().toString(); Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        db.update("INSERT INTO messages(id,room_id,sender_id,client_msg_id,content,created_at) VALUES (?,?,?,?,?,?)",
            id, room, user, clientMsgId, content.trim(), Timestamp.from(now));
        db.update("UPDATE rooms SET last_message_at=? WHERE id=?", Timestamp.from(now), room);
        if (uploadId != null && db.update("UPDATE uploads SET message_id=? WHERE id=? AND owner_id=? AND room_id=? AND message_id IS NULL", id, uploadId,user,room)!=1)
            throw field("uploadId", "Upload must be unused, owned by sender and belong to this room");
        var recipients = db.query("SELECT user_id FROM room_members WHERE room_id=?", (rs,n)->rs.getString(1),room);
        for (String recipient : recipients) if (!recipient.equals(user)) {
            db.update("INSERT INTO message_receipts(message_id,user_id) VALUES (?,?)",id,recipient);
            String type = "dm".equals(db.queryForObject("SELECT type FROM rooms WHERE id=?",String.class,room)) ? "dm" : mentions.contains(recipient) ? "mention" : null;
            if(type != null) notifications.create(recipient,type,room,id,content.trim());
        }
        var message = db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, id);
        return new Delivery(message, recipients, true);
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

    /**
     * Tìm tin trong phòng theo từ khoá (chuỗi con, không phân biệt hoa thường; collation MySQL bỏ qua dấu).
     * Kết quả mới nhất trước; `before` là ID tin cuối của trang trước.
     */
    @Transactional(readOnly = true)
    public MessagePage search(String room, String user, String query, int limit, String before) {
        if (limit < 1 || limit > 50) throw field("limit", "Limit must be between 1 and 50");
        String q = query == null ? "" : query.trim();
        if (q.isEmpty() || q.length() > 100) throw field("q", "Search must contain 1–100 characters");
        room(room, user); requireMember(room, user);
        String pattern = "%" + q.toLowerCase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
        String sql = MESSAGE_SELECT + "WHERE m.room_id=? AND m.deleted_at IS NULL AND m.activity IS NULL AND LOWER(m.content) LIKE ? ESCAPE '!'";
        var args = new ArrayList<Object>(List.of(room, pattern));
        if (before != null) {
            var anchor = db.query("SELECT created_at FROM messages WHERE id=? AND room_id=?", (rs, n) -> rs.getTimestamp(1), before, room);
            if (anchor.isEmpty()) throw field("before", "Invalid search cursor");
            sql += " AND (m.created_at<? OR (m.created_at=? AND m.id<?))";
            args.add(anchor.getFirst()); args.add(anchor.getFirst()); args.add(before);
        }
        args.add(limit + 1);
        var messages = new ArrayList<>(db.query(sql + " ORDER BY m.created_at DESC,m.id DESC LIMIT ?", MESSAGE, args.toArray()));
        boolean more = messages.size() > limit;
        if (more) messages.removeLast();
        return new MessagePage(messages, more ? messages.getLast().id() : null);
    }

    static final int MAX_POLL_OPTIONS = 10;
    /** Bình chọn = một tin nhắn kèm câu hỏi và các lựa chọn; mọi thành viên thấy realtime qua message:new. */
    public Message createPoll(String room, String user, CreatePoll input) {
        String question = input == null || input.question() == null ? "" : input.question().trim();
        if (question.isEmpty() || question.length() > 200) throw field("question", "Question must contain 1–200 characters");
        var options = input.options() == null ? List.<String>of() : input.options().stream()
            .map(o -> o == null ? "" : o.trim()).filter(o -> !o.isEmpty()).toList();
        if (options.size() < 2 || options.size() > MAX_POLL_OPTIONS) throw field("options", "A poll needs 2–" + MAX_POLL_OPTIONS + " options");
        if (options.stream().anyMatch(o -> o.length() > 100)) throw field("options", "Each option must contain at most 100 characters");
        if (new HashSet<>(options.stream().map(o -> o.toLowerCase(Locale.ROOT)).toList()).size() != options.size()) throw field("options", "Options must be different");
        String clientMsgId = input.clientMsgId() == null ? UUID.randomUUID().toString() : input.clientMsgId();
        var delivery = send(room, user, "📊 " + question, clientMsgId);
        String messageId = delivery.message().id();
        if (delivery.created()) {
            String pollId = UUID.randomUUID().toString();
            db.update("INSERT INTO polls(id,room_id,message_id,question,multiple,created_by,created_at) VALUES (?,?,?,?,?,?,?)",
                pollId, room, messageId, question, input.multiple() == null || input.multiple(), user, now());
            for (int i = 0; i < options.size(); i++)
                db.update("INSERT INTO poll_options(id,poll_id,sort_order,label) VALUES (?,?,?,?)", UUID.randomUUID().toString(), pollId, i, options.get(i));
        }
        var message = db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, messageId);
        if (delivery.created()) events.send(delivery.recipients(), "/queue/events", "message:new", message);
        return message;
    }
    /** Đặt lại toàn bộ lựa chọn của mình (gửi lại cùng danh sách không đổi gì); danh sách rỗng = bỏ bình chọn. */
    /** Khoá dòng poll, kiểm tra thành viên / phòng / tin chưa xoá. Trả về [room_id, message_id, multiple, question, created_by, closed]. */
    private Object[] lockPoll(String pollId, String user) {
        var polls = db.query("SELECT room_id, message_id, multiple, question, created_by, closed_at FROM polls WHERE id=? FOR UPDATE",
            (rs, n) -> new Object[]{rs.getString(1), rs.getString(2), rs.getBoolean(3), rs.getString(4), rs.getString(5), rs.getTimestamp(6) != null}, pollId);
        if (polls.isEmpty()) throw new ApiException(404, "invalid_payload", "not_found", "Poll not found");
        var poll = polls.getFirst();
        requireMember((String) poll[0], user); requireWritable((String) poll[0]);
        if (db.queryForObject("SELECT COUNT(*) FROM messages WHERE id=? AND deleted_at IS NOT NULL", Integer.class, poll[1]) > 0)
            throw field("pollId", "The poll was deleted");
        return poll;
    }
    public Message vote(String pollId, String user, Vote input) {
        var poll = lockPoll(pollId, user);
        String room = (String) poll[0], messageId = (String) poll[1];
        if ((Boolean) poll[5]) throw new ApiException(409, "invalid_payload", "poll_closed", "The poll is closed");
        var chosen = input == null || input.optionIds() == null ? List.<String>of() : List.copyOf(new LinkedHashSet<>(input.optionIds()));
        if (!(Boolean) poll[2] && chosen.size() > 1) throw field("optionIds", "Choose one option");
        var valid = new HashSet<>(db.query("SELECT id FROM poll_options WHERE poll_id=?", (rs, n) -> rs.getString(1), pollId));
        if (!valid.containsAll(chosen)) throw field("optionIds", "Unknown poll option");
        var before = new HashSet<>(db.query("SELECT option_id FROM poll_votes WHERE poll_id=? AND user_id=?", (rs, n) -> rs.getString(1), pollId, user));
        db.update("DELETE FROM poll_votes WHERE poll_id=? AND user_id=?", pollId, user);
        for (String option : chosen) db.update("INSERT INTO poll_votes(option_id,user_id,poll_id,created_at) VALUES (?,?,?,?)", option, user, pollId, now());
        var message = db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, messageId);
        events.send(recipients(room), "/queue/events", "message:poll", message);
        // Dòng hoạt động "X đã bình chọn / đổi lựa chọn / bỏ bình chọn" (gửi lại cùng lựa chọn thì không tạo).
        if (!before.equals(new HashSet<>(chosen)))
            activity(room, user, before.isEmpty() ? "vote" : chosen.isEmpty() ? "unvote" : "change", pollId, (String) poll[3]);
        return message;
    }
    /** Khoá bình chọn: người tạo, trưởng nhóm hoặc phó nhóm. Khoá lại lần nữa không đổi gì. */
    public Message closePoll(String pollId, String user) {
        var poll = lockPoll(pollId, user);
        String room = (String) poll[0], messageId = (String) poll[1];
        String role = role(room, user);
        if (!user.equals(poll[4]) && !"owner".equals(role) && !"deputy".equals(role)) throw forbidden();
        if (!(Boolean) poll[5]) {
            db.update("UPDATE polls SET closed_at=?, closed_by=? WHERE id=?", now(), user, pollId);
            var message = db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, messageId);
            events.send(recipients(room), "/queue/events", "message:poll", message);
            activity(room, user, "close", pollId, (String) poll[3]);
            return message;
        }
        return db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, messageId);
    }
    /** Tin hệ thống trong khung chat: không receipts / thông báo, không tính chưa đọc, không đổi thứ tự phòng. */
    private void activity(String room, String user, String type, String pollId, String question) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO messages(id,room_id,sender_id,client_msg_id,content,created_at,activity,activity_poll_id) VALUES (?,?,?,?,?,?,?,?)",
            id, room, user, UUID.randomUUID().toString(), question, now(), type, pollId);
        events.send(recipients(room), "/queue/events", "message:new", db.queryForObject(MESSAGE_SELECT + "WHERE m.id=?", MESSAGE, id));
    }
    private Activity activity(ResultSet rs) throws SQLException {
        String type = rs.getString("activity");
        if (type == null) return null;
        String pollId = rs.getString("activity_poll_id");
        String pollMessage = db.query("SELECT message_id FROM polls WHERE id=?", (r, n) -> r.getString(1), pollId).stream().findFirst().orElse(null);
        return new Activity(type, pollId, pollMessage);
    }
    private Poll poll(String messageId) {
        var polls = db.query("SELECT id, question, multiple, created_by, closed_at, closed_by FROM polls WHERE message_id=?",
            (rs, n) -> new Object[]{rs.getString(1), rs.getString(2), rs.getBoolean(3), rs.getString(4), instant(rs, "closed_at"), rs.getString(6)}, messageId);
        if (polls.isEmpty()) return null;
        var p = polls.getFirst();
        String pollId = (String) p[0];
        var options = db.query("SELECT id, label FROM poll_options WHERE poll_id=? ORDER BY sort_order", (rs, n) -> new PollOption(rs.getString(1), rs.getString(2),
            db.query("SELECT user_id FROM poll_votes WHERE option_id=? ORDER BY created_at, user_id", (v, i) -> v.getString(1), rs.getString(1))), pollId);
        return new Poll(pollId, (String) p[1], (Boolean) p[2], (String) p[3], options, (Instant) p[4], (String) p[5]);
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
    /** Includes disabled accounts so the list agrees with memberCount. Requires membership. */
    @Transactional(readOnly = true)
    public List<RoomMember> members(String room, String user) {
        room(room, user); requireMember(room, user);
        return memberList(room);
    }
    public List<RoomMember> memberList(String room) {
        return db.query("SELECT u.id,u.display_name,u.email,u.enabled,m.role FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? "
                + "ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'deputy' THEN 1 ELSE 2 END, u.display_name,u.id",
            (rs, n) -> new RoomMember(rs.getString(1), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getString(5)), room);
    }
    public Room addMember(String room, String actor, AddMember input) {
        String target = input == null ? null : input.userId();
        lockEnabledUser(target);
        requireChannel(room); requireMember(room, actor); requireWritable(room);
        insertMember(room, target);
        return room(room, actor);
    }
    public void lockEnabledUser(String user) {
        if (user == null || user.isBlank() || user.length() > 36) throw field("userId", "Employee ID required");
        var users = db.query("SELECT enabled FROM users WHERE id=? FOR UPDATE", (rs, n) -> rs.getBoolean(1), user);
        if (users.isEmpty() || !users.getFirst()) throw field("userId", "Enabled employee not found");
    }
    public void insertMember(String room, String user) {
        if (member(room, user)) return;
        db.update("INSERT INTO room_members(room_id,user_id,joined_at) VALUES (?,?,?)", room, user, now());
        // Người được thêm thấy nhóm ngay, không cần tải lại (gửi sau khi transaction commit).
        events.send(List.of(user), "/queue/events", "room:added", room(room, user));
    }
    /** Đổi tên / ảnh nhóm: thành viên của kênh đang mở (chưa lưu trữ). */
    public void requireGroupEditor(String room, String user) {
        requireChannel(room); requireMember(room, user); requireWritable(room);
    }
    public Room renameRoom(String room, String actor, RenameRoom input) {
        String name = validateRoom(new CreateRoom(input == null ? null : input.name(), null)).name();
        requireGroupEditor(room, actor);
        db.update("UPDATE rooms SET name=?, name_key=? WHERE id=?", name, name.toLowerCase(Locale.ROOT), room);
        broadcastRoom(room);
        return room(room, actor);
    }
    /** Biệt danh cho người còn lại trong DM; chuỗi rỗng = bỏ biệt danh. Chỉ người đặt thấy. */
    public Room setNickname(String room, String actor, SetNickname input) {
        requireMember(room, actor);
        if (!"dm".equals(lockRoom(room))) throw field("nickname", "Nicknames are only available in direct messages");
        String nickname = input == null || input.nickname() == null ? "" : input.nickname().trim();
        if (nickname.length() > 40 || nickname.codePoints().anyMatch(Character::isISOControl)) throw field("nickname", "Nickname must contain at most 40 characters");
        db.update("DELETE FROM room_nicknames WHERE room_id=? AND user_id=?", room, actor);
        if (!nickname.isEmpty()) db.update("INSERT INTO room_nicknames(room_id,user_id,nickname) VALUES (?,?,?)", room, actor, nickname);
        Room updated = room(room, actor);
        events.send(List.of(actor), "/queue/events", "room:updated", updated);
        return updated;
    }
    /** Ghi nhận ảnh nhóm mới (null = xoá); file do controller lưu. */
    public Room setAvatar(String room, String actor, String mediaType) {
        db.update("UPDATE rooms SET avatar_media_type=?, avatar_updated_at=? WHERE id=?", mediaType,
            mediaType == null ? null : Timestamp.from(Instant.now()), room);
        broadcastRoom(room);
        return room(room, actor);
    }
    public String avatarType(String room, String user) {
        requireMember(room, user);
        return db.query("SELECT avatar_media_type FROM rooms WHERE id=? AND type='channel'", (rs, n) -> rs.getString(1), room)
            .stream().filter(Objects::nonNull).findFirst().orElseThrow(ChatService::notFound);
    }
    /** Mỗi thành viên nhận Room nhìn từ phía mình (tên, số chưa đọc...). */
    private void broadcastRoom(String room) {
        for (String member : recipients(room)) events.send(List.of(member), "/queue/events", "room:updated", room(room, member));
    }
    public void requireWritable(String room) {
        var archived = db.query("SELECT archived FROM rooms WHERE id=?", (rs, n) -> rs.getBoolean(1), room);
        if (archived.isEmpty()) throw notFound();
        if (archived.getFirst()) throw new ApiException(409, "invalid_payload", "room_archived", "Group is archived");
    }
    public void requireMember(String room, String user) { if (!member(room, user)) throw forbidden(); }
    public List<String> recipients(String room) { return db.query("SELECT user_id FROM room_members WHERE room_id=?",(rs,n)->rs.getString(1),room); }
    public Message message(String id, String user) {
        var found=db.query(MESSAGE_SELECT+"WHERE m.id=?",MESSAGE,id);
        if(found.isEmpty()) throw notFound(); requireMember(found.getFirst().roomId(),user); return found.getFirst();
    }
    private Object attachment(String id) {
        var rows=db.query("SELECT id,filename,media_type,size_bytes FROM uploads WHERE message_id=?",(rs,n)->Map.of("id",rs.getString(1),"filename",rs.getString(2),"mediaType",rs.getString(3),"size",rs.getLong(4),"url","/api/uploads/"+rs.getString(1)),id);
        return rows.isEmpty()?null:rows.getFirst();
    }
    private Object receipts(String id) {
        return db.queryForObject("SELECT COUNT(*), COUNT(delivered_at), COUNT(seen_at) FROM message_receipts WHERE message_id=?",(rs,n)->Map.of("recipients",rs.getInt(1),"delivered",rs.getInt(2),"seen",rs.getInt(3)),id);
    }
    private Object reactions(String id) {
        return db.query("SELECT user_id,emoji FROM message_reactions WHERE message_id=? ORDER BY emoji,user_id",(rs,n)->Map.of("userId",rs.getString(1),"emoji",rs.getString(2)),id);
    }
    private Room room(String id, String user) {
        var rooms = db.query("SELECT * FROM rooms WHERE id=?", (rs, n) -> {
            boolean joined = member(id, user); String type = rs.getString("type");
            UserSummary peer = null;
            String nickname = null;
            List<UserSummary> preview = List.of();
            if (type.equals("dm")) {
                if (!joined) throw forbidden();
                peer = db.queryForObject("SELECT u.id,u.display_name,u.email FROM users u JOIN room_members m ON u.id=m.user_id WHERE m.room_id=? AND u.id<>?",
                    (row, i) -> new UserSummary(row.getString(1), row.getString(2), row.getString(3)), id, user);
                nickname = db.query("SELECT nickname FROM room_nicknames WHERE room_id=? AND user_id=?", (row, i) -> row.getString(1), id, user)
                    .stream().findFirst().orElse(null);
            } else if (joined) {
                // Avatar mặc định của nhóm: tối đa 3 thành viên, ưu tiên người khác trước mình.
                preview = db.query("SELECT u.id,u.display_name,u.email FROM users u JOIN room_members m ON u.id=m.user_id WHERE m.room_id=? "
                    + "ORDER BY CASE WHEN u.id=? THEN 1 ELSE 0 END, u.display_name, u.id LIMIT 3",
                    (row, i) -> new UserSummary(row.getString(1), row.getString(2), row.getString(3)), id, user);
            }
            Instant avatarAt = instant(rs, "avatar_updated_at");
            String avatarUrl = type.equals("channel") && avatarAt != null ? "/api/rooms/" + id + "/avatar?v=" + avatarAt.toEpochMilli() : null;
            String displayName = peer == null ? rs.getString("name") : nickname != null ? nickname : peer.displayName();
            return new Room(id, type, displayName, rs.getString("description"),
                db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=?", Integer.class, id), joined, peer, instant(rs, "last_message_at"), rs.getBoolean("archived"),
                joined ? unreadCount(id, user) : 0, nickname, avatarUrl, preview,
                joined && type.equals("channel") ? role(id, user) : null);
        }, id);
        if (rooms.isEmpty()) throw notFound(); return rooms.getFirst();
    }
    /**
     * Tin chưa đọc: tin của người khác (chưa xoá, mình chưa xem) mới hơn tin cuối cùng mình đã xem
     * hoặc đã gửi trong phòng. Dựa trên message_receipts nên đúng trên mọi thiết bị.
     */
    private int unreadCount(String room, String user) {
        return db.queryForObject("""
            SELECT COUNT(*) FROM messages m JOIN message_receipts r ON r.message_id=m.id AND r.user_id=?
            WHERE m.room_id=? AND m.deleted_at IS NULL AND r.seen_at IS NULL AND m.created_at > COALESCE(
              (SELECT MAX(m2.created_at) FROM messages m2 LEFT JOIN message_receipts r2 ON r2.message_id=m2.id AND r2.user_id=?
               WHERE m2.room_id=? AND (m2.sender_id=? OR r2.seen_at IS NOT NULL)), ?)
            """, Integer.class, user, room, user, room, user, Timestamp.from(Instant.EPOCH));
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
