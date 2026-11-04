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
    /** 200 Room khi đã thêm; 202 { pending, request, room } khi nhóm cần trưởng / phó nhóm duyệt. */
    public ResponseEntity<Object> addMember(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody AddMember input) {
        Object result = chat.addMember(id, user.userId(), input);
        return ResponseEntity.status(result instanceof PendingAdd ? 202 : 200).body(result);
    }
    @PatchMapping("/rooms/{id}/settings")
    public Room settings(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody RoomSettings input) {
        return chat.updateSettings(id, user.userId(), input);
    }
    @GetMapping("/rooms/{id}/requests")
    public Object requests(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return Map.of("requests", chat.listRequests(id, user.userId()));
    }
    @PostMapping("/rooms/{id}/requests/{requestId}/{decision:approve|reject}")
    public Object decide(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @PathVariable String requestId, @PathVariable String decision) {
        return Map.of("requests", chat.decideRequest(id, user.userId(), requestId, decision.equals("approve")));
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
    @PutMapping("/messages/{id}/pin")
    public Message pin(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody Pin input) {
        return chat.pin(id, user.userId(), input);
    }
    @GetMapping("/rooms/{id}/pins")
    public Object pins(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return Map.of("messages", chat.pins(id, user.userId()));
    }
    @PostMapping("/messages/{id}/hide")
    public Object hide(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return chat.hide(id, user.userId());
    }
    @GetMapping("/rooms/{id}/media")
    public MediaPage media(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestParam(defaultValue = "image") String kind,
                           @RequestParam(defaultValue = "20") int limit, @RequestParam(required = false) String before) {
        return chat.media(id, user.userId(), kind, limit, before);
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
        return chat.setPollClosed(id, user.userId(), true);
    }
    @PostMapping("/polls/{id}/reopen")
    public Message reopenPoll(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return chat.setPollClosed(id, user.userId(), false);
    }
    @PutMapping("/polls/{id}/votes")
    public Message vote(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id, @RequestBody Vote input) {
        return chat.vote(id, user.userId(), input);
    }
}
