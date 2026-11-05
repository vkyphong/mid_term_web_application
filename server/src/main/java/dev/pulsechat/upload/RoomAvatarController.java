package dev.pulsechat.upload;

import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatDtos.Room;
import dev.pulsechat.chat.ChatService;
import dev.pulsechat.common.ApiException;
import java.io.IOException;
import java.nio.file.*;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Ảnh đại diện nhóm: thành viên đổi/xoá (nhóm chưa lưu trữ), thành viên tải về bằng Bearer token. */
@RestController
@RequestMapping("/api/rooms/{id}/avatar")
public class RoomAvatarController {
    static final long MAX_BYTES = 2 * 1024 * 1024;
    private final Path directory; private final ChatService chat;
    public RoomAvatarController(@Value("${app.upload-directory:./uploads}") String directory, ChatService chat) throws IOException {
        this.directory = Path.of(directory).toAbsolutePath().normalize().resolve("room-avatars");
        Files.createDirectories(this.directory); this.chat = chat;
    }
    private Path file(String room) {
        Path path = directory.resolve(room).normalize();
        if (!path.getParent().equals(directory)) throw new ApiException(404, "invalid_payload", "not_found", "Room not found");
        return path;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional(rollbackFor = IOException.class)
    public Room upload(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestParam MultipartFile file) throws IOException {
        chat.requireGroupEditor(id, user.userId());
        if (file.isEmpty() || file.getSize() > MAX_BYTES) throw ChatService.field("file", "Avatar must contain 1–2097152 bytes");
        String name = Objects.requireNonNullElse(file.getOriginalFilename(), "avatar").replaceAll("[\\\\/\\p{Cntrl}]", "_");
        byte[] bytes = file.getBytes();
        String media = UploadTypes.detect(name, bytes);
        if (!media.startsWith("image/")) throw ChatService.field("file", "Avatar must be a JPEG or PNG image");
        Path temp = Files.createTempFile(directory, "avatar-", ".tmp");
        try {
            Files.write(temp, bytes);
            Files.move(temp, file(id), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(temp);
        }
        return chat.setAvatar(id, user.userId(), media);
    }

    @DeleteMapping
    public Room remove(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) throws IOException {
        chat.requireGroupEditor(id, user.userId());
        Room room = chat.setAvatar(id, user.userId(), null);
        Files.deleteIfExists(file(id));
        return room;
    }

    @GetMapping
    public ResponseEntity<FileSystemResource> download(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        String media = chat.avatarType(id, user.userId());
        Path path = file(id);
        if (!Files.isRegularFile(path)) throw new ApiException(404, "invalid_payload", "not_found", "Avatar not found");
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(media))
            .header("Cache-Control", "private, max-age=86400").header("X-Content-Type-Options", "nosniff")
            .header("Content-Security-Policy", "sandbox").body(new FileSystemResource(path));
    }
}
