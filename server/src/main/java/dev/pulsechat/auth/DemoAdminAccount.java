package dev.pulsechat.auth;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Tạo tài khoản admin demo khi khởi động (DEMO_ADMIN_*); email đã có thì chỉ cấp quyền. */
@Component
public class DemoAdminAccount implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DemoAdminAccount.class);
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final JdbcTemplate db;
    private final String email;
    private final String password;
    private final String name;

    public DemoAdminAccount(UserRepository users, PasswordEncoder passwords, JdbcTemplate db,
            @Value("${app.demo-admin.email:}") String email,
            @Value("${app.demo-admin.password:}") String password,
            @Value("${app.demo-admin.name:Quản trị viên}") String name) {
        this.users = users; this.passwords = passwords; this.db = db;
        this.email = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        this.password = password == null ? "" : password;
        this.name = name == null || name.isBlank() ? "Quản trị viên" : name.trim();
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (email.isEmpty()) return;
        if (users.findByEmail(email).isEmpty()) {
            if (password.length() < 8 || password.getBytes(StandardCharsets.UTF_8).length > 72
                    || !password.matches("(?s).*[A-Za-z].*") || !password.matches("(?s).*\\d.*")) {
                log.warn("Demo admin skipped: DEMO_ADMIN_PASSWORD needs 8+ characters with letters and digits");
                return;
            }
            users.saveAndFlush(new User(email, name.length() > 50 ? name.substring(0, 50) : name, passwords.encode(password)));
            log.info("Created demo admin account {}", email);
        }
        db.update("UPDATE users SET role='admin', enabled=TRUE WHERE email=?", email);
    }
}
