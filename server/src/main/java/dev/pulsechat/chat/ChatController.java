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
    private final MessageActions actions;
    public ChatController(ChatService chat, MessageActions actions) { this.chat = chat; this.actions=actions; }
    @GetMapping("/messages/{id}/receipts")
    public Object receipts(@AuthenticationPrincipal SessionPrincipal user,@PathVariable String id){return actions.receipts(user.userId(),id);}
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
    @GetMapping("/rooms/{id}/members")
    public Object members(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return Map.of("members", chat.members(id, user.userId()));
    }
    @PostMapping("/rooms/{id}/members")
    public Room addMember(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody AddMember input) {
        return chat.addMember(id, user.userId(), input);
    }
    @PatchMapping("/rooms/{id}")
    public Room rename(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody RenameRoom input) {
        try { return chat.renameRoom(id, user.userId(), input); }
        catch (DuplicateKeyException e) { throw new ApiException(409, "invalid_payload", "room_name_taken", "Channel name already exists"); }
    }
    @PutMapping("/rooms/{id}/nickname")
    public Room nickname(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody SetNickname input) {
        return chat.setNickname(id, user.userId(), input);
    }
    @GetMapping("/rooms/{id}/messages")
    public MessagePage messages(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id,
                               @RequestParam(defaultValue = "30") int limit, @RequestParam(required = false) String before) {
        return chat.history(id, user.userId(), limit, before);
    }
    @GetMapping("/rooms/{id}/search")
    public MessagePage search(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestParam(defaultValue = "") String q,
                              @RequestParam(defaultValue = "20") int limit, @RequestParam(required = false) String before) {
        return chat.search(id, user.userId(), q, limit, before);
    }
    @PutMapping("/rooms/{id}/members/{userId}/role")
    public Object role(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @PathVariable String userId, @RequestBody SetRole input) {
        return Map.of("members", chat.setRole(id, user.userId(), userId, input));
    }
    @PostMapping("/rooms/{id}/polls")
    public ResponseEntity<Message> createPoll(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody CreatePoll input) {
        return ResponseEntity.status(201).body(chat.createPoll(id, user.userId(), input));
    }
    @PostMapping("/polls/{id}/close")
    public Message closePoll(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return chat.closePoll(id, user.userId());
    }
    @PutMapping("/polls/{id}/votes")
    public Message vote(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody Vote input) {
        return chat.vote(id, user.userId(), input);
    }
}
