package dev.pulsechat.chat;

import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.common.ApiException;
import static dev.pulsechat.chat.ChatDtos.*;

@RestController
@RequestMapping("/api")
public class ChatController {
    private final ChatService chat;
    public ChatController(ChatService chat) { this.chat = chat; }
    @GetMapping("/rooms")
    public Object rooms(@AuthenticationPrincipal SessionPrincipal user) { return Map.of("rooms", chat.listRooms(user.userId())); }
    @PostMapping("/rooms")
    public ResponseEntity<Room> create(@AuthenticationPrincipal SessionPrincipal user, @RequestBody CreateRoom input) {
        try { return ResponseEntity.status(201).body(chat.createRoom(user.userId(), input)); }
        catch (DuplicateKeyException e) { throw new ApiException(409, "invalid_payload", "room_name_taken", "Channel name already exists"); }
    }
    @GetMapping("/users")
    public Object users(@AuthenticationPrincipal SessionPrincipal user, @RequestParam(defaultValue = "") String search,
                        @RequestParam(defaultValue = "20") int limit) {
        return Map.of("users", chat.searchUsers(user.userId(), search, limit));
    }
    @PostMapping("/dms")
    public Room dm(@AuthenticationPrincipal SessionPrincipal user, @RequestBody OpenDm input) { return chat.openDm(user.userId(), input); }
    @GetMapping("/rooms/{id}/messages")
    public MessagePage messages(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id,
                               @RequestParam(defaultValue = "30") int limit, @RequestParam(required = false) String before) {
        return chat.history(id, user.userId(), limit, before);
    }
}
