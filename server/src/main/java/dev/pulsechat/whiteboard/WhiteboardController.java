package dev.pulsechat.whiteboard;

import dev.pulsechat.auth.SessionPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
public class WhiteboardController {
    private final WhiteboardService boards;
    public WhiteboardController(WhiteboardService boards) { this.boards = boards; }
    @GetMapping("/api/rooms/{id}/whiteboard")
    public WhiteboardService.Snapshot snapshot(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) {
        return boards.snapshot(id, user.userId());
    }
}
