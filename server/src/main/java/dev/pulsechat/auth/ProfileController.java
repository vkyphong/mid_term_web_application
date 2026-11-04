package dev.pulsechat.auth;

import dev.pulsechat.chat.ChatService;
import java.sql.Date;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

/** Thông tin tài khoản của chính mình: tên hiển thị, giới tính, ngày sinh, điện thoại. */
@RestController
@RequestMapping("/api/me/profile")
public class ProfileController {
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record Profile(String id, String email, String displayName, String gender, String birthDate, String phone, String avatarUrl) {}
    public record ProfileInput(String displayName, String gender, String birthDate, String phone) {}
    static final Set<String> GENDERS = Set.of("male", "female", "other");
    private final JdbcTemplate db;
    public ProfileController(JdbcTemplate db) { this.db = db; }

    @GetMapping
    public Profile get(@AuthenticationPrincipal SessionPrincipal user) {
        return db.queryForObject("SELECT id,email,display_name,gender,birth_date,phone,avatar_updated_at FROM users WHERE id=?", (rs, n) -> {
            Date birth = rs.getDate(5);
            var avatarAt = rs.getTimestamp(7);
            return new Profile(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                birth == null ? null : birth.toLocalDate().toString(), rs.getString(6),
                avatarAt == null ? null : "/api/users/" + rs.getString(1) + "/avatar?v=" + avatarAt.toInstant().toEpochMilli());
        }, user.userId());
    }

    @PutMapping
    @Transactional
    public Profile update(@AuthenticationPrincipal SessionPrincipal user, @RequestBody ProfileInput input) {
        if (input == null) throw ChatService.field("displayName", "Profile required");
        String name = input.displayName() == null ? "" : input.displayName().trim();
        if (name.length() < 2 || name.length() > 50) throw ChatService.field("displayName", "Tên hiển thị cần 2–50 ký tự");
        String gender = blank(input.gender());
        if (gender != null && !GENDERS.contains(gender)) throw ChatService.field("gender", "Giới tính không hợp lệ");
        LocalDate birth = null;
        if (blank(input.birthDate()) != null) {
            try { birth = LocalDate.parse(input.birthDate().trim()); }
            catch (DateTimeParseException e) { throw ChatService.field("birthDate", "Ngày sinh không hợp lệ"); }
            if (birth.isBefore(LocalDate.of(1900, 1, 1)) || birth.isAfter(LocalDate.now())) throw ChatService.field("birthDate", "Ngày sinh không hợp lệ");
        }
        String phone = blank(input.phone());
        if (phone != null && !phone.matches("\\+?[0-9][0-9 .-]{6,18}[0-9]")) throw ChatService.field("phone", "Số điện thoại không hợp lệ");
        db.update("UPDATE users SET display_name=?, gender=?, birth_date=?, phone=? WHERE id=?",
            name, gender, birth == null ? null : Date.valueOf(birth), phone, user.userId());
        return get(user);
    }

    private static String blank(String value) { return value == null || value.isBlank() ? null : value.trim(); }
}
