package dev.pulsechat.auth;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {
    @Id @Column(length = 36) private String id;
    @Column(nullable = false, unique = true, length = 254) private String email;
    @Column(name = "display_name", nullable = false, length = 50) private String displayName;
    @Column(name = "password_hash", nullable = false, length = 100) private String passwordHash;
    @Column(nullable = false, length = 16) private String role;
    @Column(nullable = false) private boolean enabled;
    protected User() {}
    public User(String email, String displayName, String passwordHash) {
        this.id = UUID.randomUUID().toString(); this.email = email; this.displayName = displayName;
        this.passwordHash = passwordHash; this.role = "user"; this.enabled = true;
    }
    public String getId() { return id; }
    public String getEmail() { return email; }
    public String getDisplayName() { return displayName; }
    public String getPasswordHash() { return passwordHash; }
    public String getRole() { return role; }
    public boolean isEnabled() { return enabled; }
}
