package dev.pulsechat.upload;

import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.ApiException;
import dev.pulsechat.realtime.RealtimeEvents;
import java.io.IOException;
import java.nio.file.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Ảnh đại diện tài khoản: mỗi người tự đổi/xoá ảnh của mình, mọi nhân viên đã đăng nhập xem được. */
@RestController
@RequestMapping("/api")
public class UserAvatarController {
    static final long MAX_BYTES = 5 * 1024 * 1024;
    public record UserAvatar(String userId, String avatarUrl) {}
    private final Path directory; private final JdbcTemplate db; private final RealtimeEvents events;
    public UserAvatarController(@Value("${app.upload-directory:./uploads}") String directory, JdbcTemplate db, RealtimeEvents events) throws IOException {
        this.directory = Path.of(directory).toAbsolutePath().normalize().resolve("user-avatars");
        Files.createDirectories(this.directory); this.db = db; this.events = events;
    }
    private Path file(String user) {
        Path path = directory.resolve(user).normalize();
        if (!path.getParent().equals(directory)) throw new ApiException(404, "invalid_payload", "not_found", "Avatar not found");
        return path;
    }
    private static String url(String user, Timestamp at) { return at == null ? null : "/api/users/" + user + "/avatar?v=" + at.toInstant().toEpochMilli(); }

    /** Báo cho mọi nhân viên đang hoạt động để avatar đổi ngay trên màn hình của họ. */
    private UserAvatar publish(String user, Timestamp at) {
        var avatar = new UserAvatar(user, url(user, at));
        events.send(db.queryForList("SELECT id FROM users WHERE enabled=TRUE", String.class), "/queue/events", "user:avatar", avatar);
        return avatar;
    }

    @PostMapping(path = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional(rollbackFor = IOException.class)
    public UserAvatar upload(@AuthenticationPrincipal SessionPrincipal user, @RequestParam MultipartFile file) throws IOException {
        if (file.isEmpty() || file.getSize() > MAX_BYTES) throw ChatService.field("file", "Avatar must contain 1–" + MAX_BYTES + " bytes");
        String name = Objects.requireNonNullElse(file.getOriginalFilename(), "avatar").replaceAll("[\\\\/\\p{Cntrl}]", "_");
        byte[] bytes = file.getBytes();
        String media = UploadTypes.detect(name, bytes);
        if (!media.startsWith("image/")) throw ChatService.field("file", "Avatar must be a JPEG or PNG image");
        Path temp = Files.createTempFile(directory, "avatar-", ".tmp");
        try {
            Files.write(temp, bytes);
            Files.move(temp, file(user.userId()), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temp);
        }
        Timestamp at = Timestamp.from(Instant.now());
        db.update("UPDATE users SET avatar_media_type=?, avatar_updated_at=? WHERE id=?", media, at, user.userId());
        return publish(user.userId(), at);
    }

    @DeleteMapping("/me/avatar")
    @Transactional
    public UserAvatar remove(@AuthenticationPrincipal SessionPrincipal user) throws IOException {
        db.update("UPDATE users SET avatar_media_type=NULL, avatar_updated_at=NULL WHERE id=?", user.userId());
        Files.deleteIfExists(file(user.userId()));
        return publish(user.userId(), null);
    }

    /** Ai có ảnh đại diện (danh sách nhỏ, client tự ghép theo userId). */
    @GetMapping("/users/avatars")
    public Map<String, List<UserAvatar>> list(@AuthenticationPrincipal SessionPrincipal user) {
        return Map.of("avatars", db.query("SELECT id, avatar_updated_at FROM users WHERE avatar_updated_at IS NOT NULL",
            (rs, n) -> new UserAvatar(rs.getString(1), url(rs.getString(1), rs.getTimestamp(2)))));
    }

    @GetMapping("/users/{id}/avatar")
    public ResponseEntity<FileSystemResource> download(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        String media = db.query("SELECT avatar_media_type FROM users WHERE id=?", (rs, n) -> rs.getString(1), id)
            .stream().filter(Objects::nonNull).findFirst()
            .orElseThrow(() -> new ApiException(404, "invalid_payload", "not_found", "Avatar not found"));
        Path path = file(id);
        if (!Files.isRegularFile(path)) throw new ApiException(404, "invalid_payload", "not_found", "Avatar not found");
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(media))
            .header("Cache-Control", "private, max-age=86400").header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "sandbox").body(new FileSystemResource(path));
    }
}
