package dev.pulsechat.auth;
import org.springframework.data.jpa.repository.JpaRepository;
public interface RetiredRefreshTokenRepository extends JpaRepository<RetiredRefreshToken, String> {}
