package dev.pulsechat.lab;
import com.fasterxml.jackson.databind.JsonNode;
import dev.pulsechat.auth.SessionPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.servlet.mvc.method.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;
@RestController
@RequestMapping("/api/lab")
public class LabController {
    private final LabService lab;
    public LabController(LabService lab){this.lab=lab;}
    @PostMapping("/ping") public Object ping(@AuthenticationPrincipal SessionPrincipal user,@RequestBody JsonNode body){return lab.ping(user,body);}
    @GetMapping("/poll") public Object poll(@AuthenticationPrincipal SessionPrincipal user,@RequestParam(defaultValue="0") long after){return lab.poll(user,after);}
    @GetMapping("/long-poll") public DeferredResult<Object> waitFor(@AuthenticationPrincipal SessionPrincipal user,@RequestParam(defaultValue="0") long after){return lab.waitFor(user,after);}
    @GetMapping(value="/sse",produces="text/event-stream") public SseEmitter stream(@AuthenticationPrincipal SessionPrincipal user,@RequestParam(defaultValue="0") long after)throws java.io.IOException{return lab.stream(user,after);}
}
