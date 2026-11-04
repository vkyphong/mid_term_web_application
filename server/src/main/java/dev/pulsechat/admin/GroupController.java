package dev.pulsechat.admin;

import dev.pulsechat.auth.SessionPrincipal;
import dev.pulsechat.chat.ChatDtos.*;
import dev.pulsechat.common.ApiException;
import java.util.Map;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/groups")
public class GroupController {
    private final GroupService groups;
    public GroupController(GroupService groups) { this.groups = groups; }
    @GetMapping
    public GroupService.GroupPage list(@AuthenticationPrincipal SessionPrincipal actor,
            @RequestParam(defaultValue = "") String search, @RequestParam(required = false) Boolean archived,
            @RequestParam(defaultValue = "0") int page) { return groups.list(actor.userId(), search, archived, page); }
    @GetMapping("/{id}")
    public GroupService.Group detail(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id) { return groups.detail(actor.userId(), id); }
    @PostMapping
    public ResponseEntity<GroupService.Group> create(@AuthenticationPrincipal SessionPrincipal actor, @RequestBody CreateRoom input) {
        return ResponseEntity.status(201).body(groups.create(actor.userId(), input));
    }
    @PatchMapping("/{id}")
    public GroupService.Group update(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @RequestBody CreateRoom input) {
        return groups.update(actor.userId(), id, input);
    }
    @PostMapping("/{id}/archive")
    public GroupService.Group archive(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @RequestBody GroupService.Archive input) {
        return groups.archive(actor.userId(), id, input);
    }
    @GetMapping("/{id}/members")
    public Object members(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id) { return Map.of("members", groups.members(actor.userId(), id)); }
    @PostMapping("/{id}/members")
    public GroupService.Group addMember(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @RequestBody AddMember input) {
        return groups.addMember(actor.userId(), id, input);
    }
    @DeleteMapping("/{id}/members/{userId}")
    public GroupService.Group removeMember(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @PathVariable String userId) {
        return groups.removeMember(actor.userId(), id, userId);
    }
    @PutMapping("/{id}/members/{userId}/role")
    public Object setMemberRole(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @PathVariable String userId,
            @RequestBody SetRole input) {
        return Map.of("members", groups.setMemberRole(actor.userId(), id, userId, input));
    }
    @PatchMapping("/{id}/settings")
    public GroupService.Group settings(@AuthenticationPrincipal SessionPrincipal actor, @PathVariable String id, @RequestBody RoomSettings input) {
        return groups.settings(actor.userId(), id, input);
    }
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<?> duplicate() {
        return ResponseEntity.status(409).body(dev.pulsechat.common.ApiErrors.body(
            new ApiException(409, "invalid_payload", "room_name_taken", "Channel name already exists")));
    }
}
