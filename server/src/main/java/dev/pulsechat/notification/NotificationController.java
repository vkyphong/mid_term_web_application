package dev.pulsechat.notification;
import dev.pulsechat.auth.SessionPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService service;
    public NotificationController(NotificationService service){this.service=service;}
    @GetMapping public Object list(@AuthenticationPrincipal SessionPrincipal user,@RequestParam(defaultValue="30") int limit,@RequestParam(required=false) String before){return service.list(user.userId(),limit,before);}
    @PostMapping("/{id}/read") public void read(@AuthenticationPrincipal SessionPrincipal user,@PathVariable String id){service.read(user.userId(),id);}
}
