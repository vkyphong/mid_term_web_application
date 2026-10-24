package dev.pulsechat.config;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
@Controller
public class SpaController {
    @GetMapping({"/login", "/register", "/rooms/{id}"})
    String frontend() { return "forward:/index.html"; }
}
