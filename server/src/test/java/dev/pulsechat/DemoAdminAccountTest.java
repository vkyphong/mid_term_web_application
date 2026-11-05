package dev.pulsechat;

import static org.assertj.core.api.Assertions.assertThat;

import dev.pulsechat.auth.AuthDtos;
import dev.pulsechat.auth.AuthService;
import dev.pulsechat.auth.DemoAdminAccount;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:demoadmin;MODE=MySQL;DB_CLOSE_DELAY=-1",
    "app.demo-admin.email=Demo-Admin@DQGM.dev",
    "app.demo-admin.password=Admin123456",
    "app.demo-admin.name=Quản trị viên",
})
@ActiveProfiles("test")
class DemoAdminAccountTest {
    @Autowired AuthService auth;
    @Autowired JdbcTemplate db;
    @Autowired DemoAdminAccount demo;

    @Test
    void createsDemoAdminOnceAndCanLogIn() {
        var issued = auth.login(new AuthDtos.LoginInput("demo-admin@dqgm.dev", "Admin123456"));
        assertThat(issued.response().user().role()).isEqualTo("admin");
        assertThat(issued.response().user().displayName()).isEqualTo("Quản trị viên");

        // Khởi động lại (chạy lần nữa) không tạo trùng; tài khoản bị khoá / hạ quyền được khôi phục admin.
        db.update("UPDATE users SET role='user', enabled=FALSE WHERE email='demo-admin@dqgm.dev'");
        demo.run(null);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM users WHERE email='demo-admin@dqgm.dev'", Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT role FROM users WHERE email='demo-admin@dqgm.dev'", String.class)).isEqualTo("admin");
        assertThat(db.queryForObject("SELECT enabled FROM users WHERE email='demo-admin@dqgm.dev'", Boolean.class)).isTrue();
    }
}
