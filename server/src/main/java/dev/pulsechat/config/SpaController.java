package dev.pulsechat.config;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
@Controller
public class SpaController {
    @GetMapping({"/login", "/register", "/rooms/{id}", "/admin", "/lab"})
    String frontend() { return "forward:/index.html"; }
}
