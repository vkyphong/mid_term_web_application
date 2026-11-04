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

/**
 * Thông tin tài khoản: tên hiển thị, giới tính, ngày sinh, điện thoại. Chủ tài khoản luôn xem / sửa được;
 * người khác chỉ thấy giới tính / ngày sinh / điện thoại khi chủ tài khoản để công khai.
 */
@RestController
@RequestMapping("/api")
public class ProfileController {
    @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS)
    public record Profile(String id, String email, String displayName, String gender, String birthDate, String phone, String avatarUrl,
                          boolean profilePublic, boolean self) {}
    /** profilePublic null = giữ nguyên. */
    public record ProfileInput(String displayName, String gender, String birthDate, String phone, Boolean profilePublic) {}
    static final Set<String> GENDERS = Set.of("male", "female", "other");
    private final JdbcTemplate db;
    public ProfileController(JdbcTemplate db) { this.db = db; }

    @GetMapping("/me/profile")
    public Profile get(@AuthenticationPrincipal SessionPrincipal user) { return load(user.userId(), user.userId()); }

    @GetMapping("/users/{id}/profile")
    public Profile other(@AuthenticationPrincipal SessionPrincipal user, @PathVariable String id) { return load(id, user.userId()); }

    private Profile load(String id, String viewer) {
        var profiles = db.query("SELECT id,email,display_name,gender,birth_date,phone,avatar_updated_at,profile_public FROM users WHERE id=? AND enabled=TRUE", (rs, n) -> {
            boolean self = rs.getString(1).equals(viewer), open = self || rs.getBoolean(8);
            Date birth = rs.getDate(5);
            var avatarAt = rs.getTimestamp(7);
            return new Profile(rs.getString(1), rs.getString(2), rs.getString(3), open ? rs.getString(4) : null,
                open && birth != null ? birth.toLocalDate().toString() : null, open ? rs.getString(6) : null,
                avatarAt == null ? null : "/api/users/" + rs.getString(1) + "/avatar?v=" + avatarAt.toInstant().toEpochMilli(),
                rs.getBoolean(8), self);
        }, id);
        if (profiles.isEmpty()) throw new dev.pulsechat.common.ApiException(404, "invalid_payload", "not_found", "Employee not found");
        return profiles.getFirst();
    }

    @PutMapping("/me/profile")
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
        db.update("UPDATE users SET display_name=?, gender=?, birth_date=?, phone=?, profile_public=COALESCE(?, profile_public) WHERE id=?",
            name, gender, birth == null ? null : Date.valueOf(birth), phone, input.profilePublic(), user.userId());
        return get(user);
    }

    private static String blank(String value) { return value == null || value.isBlank() ? null : value.trim(); }
}
