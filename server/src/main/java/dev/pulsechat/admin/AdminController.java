package dev.pulsechat.admin;
import java.util.Map;
import dev.pulsechat.auth.SessionPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminService service;
    public AdminController(AdminService service){this.service=service;}
    @GetMapping("/stats") public Object stats(@AuthenticationPrincipal SessionPrincipal user){return service.stats(user.userId());}
    @GetMapping("/users") public Object users(@AuthenticationPrincipal SessionPrincipal user,
        @RequestParam(defaultValue="") String search, @RequestParam(defaultValue="0") int page){return service.users(user.userId(),search,page);}
    @GetMapping("/channels") public Object channels(@AuthenticationPrincipal SessionPrincipal user){return service.channels(user.userId());}
    @PostMapping("/users/{id}/ban") public void ban(@AuthenticationPrincipal SessionPrincipal user,@PathVariable String id){service.ban(user.userId(),id);}
    @PostMapping("/users/{id}/kick") public void kick(@AuthenticationPrincipal SessionPrincipal user,@PathVariable String id){service.kick(user.userId(),id);}
    @PostMapping("/broadcast") public Object broadcast(@AuthenticationPrincipal SessionPrincipal user,@RequestBody Map<String,String> input){return service.broadcast(user.userId(),input.get("content"));}
}
