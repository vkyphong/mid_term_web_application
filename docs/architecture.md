# Architecture decision: single-instance Spring application

Decision date: 2026-10-18. F01/F02 use Java 21, Spring Boot 3.5, Spring Security, Spring Data JPA and MySQL 8.4. React is built into the executable Spring Boot JAR by a multi-stage Docker build. Compose runs the application and database.
## Boundaries

The backend uses feature packages: `auth` owns accounts, persisted sessions and REST authentication; `realtime` owns STOMP authentication and socket lifecycle; `config` owns HTTP security, Origin policy and SPA routes. The existing frontend feature structure is retained, with `features/realtime` added alongside `features/auth`. No microservices or distributed state are required.

MySQL stores BCrypt password hashes and SHA-256 hashes of high-entropy opaque refresh tokens. Plain refresh tokens only appear in the HttpOnly cookie. An auth session has a fixed seven-day lifetime; rotation does not extend that lifetime. Pessimistic row locking makes refresh rotation single-use under concurrent requests. Reuse of an old refresh value returns 401; it does not revoke the newer session. Retired hashes in `retired_refresh_tokens` map pre-rotation cookies to their session for logout only, preventing an in-flight refresh response from undoing logout. Access JWTs carry a session ID; REST and inbound STOMP operations check persisted session status and account enablement. Logout revokes that session and closes its sockets after transaction commit.

All clients use one instance. A synchronized in-memory connection registry enforces five sockets per account and holds token-expiry timers. It does not implement user-visible presence, chat rooms or message persistence; those belong to later features. Restart disconnects sockets and clears temporary state; persisted refresh sessions permit re-login restoration.

## Realtime security

`/ws` uses a native WebSocket transport with STOMP 1.2, without SockJS. HTTP Upgrade checks Origin; JWT authentication is at STOMP CONNECT. Browser WebSocket APIs cannot attach arbitrary Authorization headers to the HTTP handshake. An unauthenticated socket has five seconds to CONNECT and cannot SEND/SUBSCRIBE. Access token expiry closes the connection even without traffic. Subsequent frames also check account/session state. Disabling an account blocks the next authenticated operation; an idle socket is closed by its token deadline (immediate ban broadcast is F12).

Only a session-private diagnostic subscription and ping endpoint are enabled in F02. Broker destinations and other users' queues cannot be addressed by clients. Future room subscriptions must add explicit membership authorization, rather than broadly allow `/topic/**`.

The frontend uses the same origin in Docker, an in-memory token store and bounded reconnect. Successful proactive refresh replaces the socket with a new authenticated connection. Transient refresh errors preserve the local session and retry after five seconds; 401/403 clears it. Logout changes the session revision so a pending refresh cannot resurrect local state. Web Locks serialize cookie rotation across tabs where supported; on insecure LAN origins without Web Locks, simultaneous refresh in separate tabs may require one tab to sign in again.

## HTTP and deployment

Cookie-authenticated endpoints use POST, `SameSite=Strict`, HttpOnly and an Origin guard. The application is stateless for HTTP sessions; protected REST endpoints require Bearer tokens. Same-origin requests and configured exact extra origins are accepted. No forwarded-host headers are trusted. The default HTTP mode is for local/LAN demonstration; use HTTPS and secure cookies for Internet deployment.

MySQL is isolated on the Compose network by default. The optional Workbench overlay publishes only `127.0.0.1:3307`. Flyway owns schema changes; Hibernate uses `ddl-auto=validate`. Runtime runs as a non-root user. Credentials are generated locally and excluded from Git and the Docker context.

## References

- [Spring token authentication for STOMP](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/authentication-token-based.html)
- [Spring WebSocket message authorization](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/authorization.html)
- [Spring Boot managed dependencies](https://docs.spring.io/spring-boot/3.5/appendix/dependency-versions/coordinates.html)
