package dev.pulsechat.upload;

import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatDtos.Forward;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.realtime.RealtimeEvents;
import java.io.IOException;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Chuyển tiếp tới tối đa 20 phòng; file được sao chép thành upload mới cho từng phòng. */
@RestController
@RequestMapping("/api/messages/{id}/forward")
public class ForwardController {
    static final int MAX_TARGETS = 20;
    private final Path directory; private final JdbcTemplate db; private final ChatService chat; private final RealtimeEvents events;
    public ForwardController(@Value("${app.upload-directory:./uploads}") String directory, JdbcTemplate db, ChatService chat, RealtimeEvents events) throws IOException {
        this.directory = Path.of(directory).toAbsolutePath().normalize();
        Files.createDirectories(this.directory); this.db = db; this.chat = chat; this.events = events;
    }

    @PostMapping
    @Transactional(rollbackFor = IOException.class)
    public Map<String, Object> forward(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody Forward input) throws IOException {
        var source = chat.message(id, user.userId());
        if (source.deletedAt() != null || source.activity() != null || source.poll() != null)
            throw ChatService.field("messageId", "This message cannot be forwarded");
        var rooms = input == null || input.roomIds() == null ? List.<String>of() : List.copyOf(new LinkedHashSet<>(input.roomIds()));
        if (rooms.isEmpty() || rooms.size() > MAX_TARGETS) throw ChatService.field("roomIds", "Choose 1–" + MAX_TARGETS + " conversations");
        String note = input.note() == null ? "" : input.note().trim();
        var file = db.queryForList("SELECT id, filename, media_type, size_bytes FROM uploads WHERE message_id=?", id);
        var copies = new ArrayList<Path>();
        try {
            for (String room : rooms) {
                String uploadId = null;
                if (!file.isEmpty()) {
                    var original = file.getFirst();
                    Path from = directory.resolve((String) original.get("id")).normalize();
                    if (!from.getParent().equals(directory) || !Files.isRegularFile(from)) throw ChatService.field("messageId", "The attached file is no longer available");
                    uploadId = UUID.randomUUID().toString();
                    Path to = directory.resolve(uploadId);
                    Files.copy(from, to);
                    copies.add(to);
                    // chat.send kiểm tra mình là thành viên phòng đích và phòng chưa lưu trữ.
                    chat.requireMember(room, user.userId());
                    db.update("INSERT INTO uploads(id,room_id,owner_id,filename,media_type,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)",
                        uploadId, room, user.userId(), original.get("filename"), original.get("media_type"), original.get("size_bytes"), Timestamp.from(Instant.now()));
                }
                deliver(chat.send(room, user.userId(), source.content(), UUID.randomUUID().toString(), uploadId, List.of()));
                if (!note.isEmpty()) deliver(chat.send(room, user.userId(), note, UUID.randomUUID().toString()));
            }
        } catch (RuntimeException | IOException e) {
            for (Path copy : copies) Files.deleteIfExists(copy);
            throw e;
        }
        return Map.of("forwarded", rooms.size());
    }

    private void deliver(dev.pulsechat.chat.ChatDtos.Delivery delivery) {
        if (delivery.created()) events.send(delivery.recipients(), "/queue/events", "message:new", delivery.message());
    }
}
