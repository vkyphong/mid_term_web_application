package dev.pulsechat.whiteboard;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.ApiException;
import dev.pulsechat.realtime.RealtimeEvents;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class WhiteboardService {
    public static final int MAX_SEGMENTS = 1000;
    public record Point(double x, double y) {}
    public record Segment(String roomId, String operationId, String authorId, long generation, long revision,
                          String color, int width, List<Point> points, String createdAt) {}
    public record Snapshot(String roomId, long generation, long revision, List<Segment> segments) {}
    public record Cleared(String roomId, long generation, long revision, String operationId, String authorId) {}
    private record Board(long generation, long revision, String clearId, String clearAuthor, long clearRevision) {}
    private final JdbcTemplate db;
    private final ChatService chat;
    private final RealtimeEvents events;
    private final ObjectMapper mapper;

    public WhiteboardService(JdbcTemplate db, ChatService chat, RealtimeEvents events, ObjectMapper mapper) {
        this.db = db; this.chat = chat; this.events = events; this.mapper = mapper;
    }

    public Snapshot snapshot(String room, String user) {
        lockMember(room, user);
        var board = board(room);
        return new Snapshot(room, board.generation(), board.revision(),
            db.query("SELECT * FROM whiteboard_segments WHERE room_id=? ORDER BY revision", (rs, n) -> readSegment(rs), room));
    }

    public Segment segment(String user, JsonNode input) {
        String room = uuid(input, "roomId"), operation = uuid(input, "operationId");
        long generation = generation(input);
        String color = text(input, "color").toLowerCase(java.util.Locale.ROOT);
        if (!color.matches("#[0-9a-f]{6}")) throw ChatService.field("color", "A six-digit hex color is required");
        if (!input.path("width").isIntegralNumber() || !input.path("width").canConvertToInt()) throw ChatService.field("width", "Integer required");
        int width = input.path("width").intValue();
        if (width < 1 || width > 12) throw ChatService.field("width", "Width must be between 1 and 12");
        List<Point> points = points(input.path("points"));
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockMember(room, user);
        var board = board(room);
        var existing = db.query("SELECT * FROM whiteboard_segments WHERE room_id=? AND author_id=? AND operation_id=?",
            (rs, n) -> readSegment(rs), room, user, operation);
        if (!existing.isEmpty()) {
            var prior = existing.getFirst();
            if (prior.generation() != generation || !prior.color().equals(color) || prior.width() != width || !prior.points().equals(points))
                throw ChatService.field("operationId", "Operation ID was already used for different content");
            return prior;
        }
        requireGeneration(board, generation);
        if (db.queryForObject("SELECT COUNT(*) FROM whiteboard_segments WHERE room_id=?", Integer.class, room) >= MAX_SEGMENTS)
            throw new ApiException(409, "invalid_payload", "board_full", "Board is full; clear it before drawing more");
        ensureBoard(room);
        long revision = board.revision() + 1;
        Instant now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        String json;
        try { json = mapper.writeValueAsString(points); } catch (Exception e) { throw new IllegalStateException(e); }
        db.update("INSERT INTO whiteboard_segments(room_id,author_id,operation_id,generation,revision,color,width,points_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            room, user, operation, generation, revision, color, width, json, Timestamp.from(now));
        db.update("UPDATE whiteboards SET revision=? WHERE room_id=?", revision, room);
        var saved = new Segment(room, operation, user, generation, revision, color, width, points, now.toString());
        events.send(recipients(room), "/queue/whiteboard", "whiteboard:segment", saved);
        return saved;
    }

    public Cleared clear(String user, JsonNode input) {
        String room = uuid(input, "roomId"), operation = uuid(input, "operationId");
        long generation = generation(input);
        db.queryForList("SELECT id FROM users WHERE id=? FOR UPDATE", user);
        lockMember(room, user);
        var board = board(room);
        if (operation.equals(board.clearId()) && user.equals(board.clearAuthor())) {
            if (generation + 1 != board.generation()) throw ChatService.field("operationId", "Clear operation ID was already used");
            return new Cleared(room, board.generation(), board.clearRevision(), operation, user);
        }
        requireGeneration(board, generation);
        ensureBoard(room);
        long revision = board.revision() + 1, nextGeneration = generation + 1;
        db.update("DELETE FROM whiteboard_segments WHERE room_id=?", room);
        db.update("UPDATE whiteboards SET generation=?,revision=?,last_clear_id=?,last_clear_author=?,last_clear_revision=? WHERE room_id=?",
            nextGeneration, revision, operation, user, revision, room);
        var cleared = new Cleared(room, nextGeneration, revision, operation, user);
        events.send(recipients(room), "/queue/whiteboard", "whiteboard:cleared", cleared);
        return cleared;
    }

    private void lockMember(String room, String user) {
        if (db.queryForList("SELECT id FROM rooms WHERE id=? FOR UPDATE", room).isEmpty())
            throw new ApiException(404, "invalid_payload", "not_found", "Room not found");
        chat.requireMember(room, user);
    }
    private Board board(String room) {
        var rows = db.query("SELECT * FROM whiteboards WHERE room_id=?", (rs, n) -> new Board(
            rs.getLong("generation"), rs.getLong("revision"), rs.getString("last_clear_id"), rs.getString("last_clear_author"), rs.getLong("last_clear_revision")), room);
        return rows.isEmpty() ? new Board(0, 0, null, null, 0) : rows.getFirst();
    }
    private void ensureBoard(String room) {
        if (db.queryForObject("SELECT COUNT(*) FROM whiteboards WHERE room_id=?", Integer.class, room) == 0)
            db.update("INSERT INTO whiteboards(room_id,generation,revision) VALUES (?,0,0)", room);
    }
    private void requireGeneration(Board board, long generation) {
        if (generation != board.generation()) throw new ApiException(409, "invalid_payload", "stale_board", "Board was cleared; reload its current generation");
    }
    private List<String> recipients(String room) {
        return db.query("SELECT m.user_id FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND u.enabled=true",
            (rs, n) -> rs.getString(1), room);
    }
    private Segment readSegment(ResultSet rs) throws SQLException {
        try {
            return new Segment(rs.getString("room_id"), rs.getString("operation_id"), rs.getString("author_id"), rs.getLong("generation"),
                rs.getLong("revision"), rs.getString("color"), rs.getInt("width"), points(mapper.readTree(rs.getString("points_json"))), rs.getTimestamp("created_at").toInstant().toString());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("Invalid stored board", e); }
    }
    private static List<Point> points(JsonNode input) {
        if (!input.isArray() || input.isEmpty() || input.size() > 48) throw ChatService.field("points", "Use 1–48 points per segment");
        var result = new ArrayList<Point>();
        for (var point : input) {
            if (!point.isObject() || !point.path("x").isNumber() || !point.path("y").isNumber()) throw ChatService.field("points", "Numeric x/y required");
            double x = point.path("x").doubleValue(), y = point.path("y").doubleValue();
            if (!Double.isFinite(x) || !Double.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw ChatService.field("points", "Coordinates must be in [0,1]");
            result.add(new Point(x, y));
        }
        return List.copyOf(result);
    }
    private static long generation(JsonNode input) {
        var value = input.path("generation");
        if (!value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0 || value.longValue() > 9007199254740990L)
            throw ChatService.field("generation", "A nonnegative safe integer is required");
        return value.longValue();
    }
    private static String uuid(JsonNode input, String key) {
        String value = text(input, key);
        if (!value.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")) throw ChatService.field(key, "A UUID is required");
        return value.toLowerCase(java.util.Locale.ROOT);
    }
    private static String text(JsonNode input, String key) {
        if (input == null || !input.path(key).isTextual() || input.path(key).asText().isBlank()) throw ChatService.field(key, "A string is required");
        return input.path(key).asText();
    }
}
