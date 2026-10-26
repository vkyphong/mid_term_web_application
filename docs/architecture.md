# Architecture decision: single-instance Spring application

Java 21, Spring Boot 3.5, Spring Security, Spring Data JPA (auth), Spring JDBC (collaboration) and MySQL 8.4. React is built into the executable Spring Boot JAR by a multi-stage Docker build. Compose runs the application and database, with persistent MySQL and upload volumes. See [feature design](features/collaboration.md), [API reference](api/README.md) and [operations](operations.md).

## Boundaries

The backend uses feature packages: `auth` owns accounts and persisted sessions; `realtime` owns STOMP authentication and socket lifecycle; `chat` owns rooms, messages, receipts and reactions. `presence`, `notification`, `admin`, `upload` and `lab` own their corresponding features. `config` provides HTTP security, Origin policy and SPA routes; `common` provides API errors. Collaboration features use explicit SQL and Spring-managed transactions; Flyway owns schema constraints and indexes.

MySQL stores BCrypt password hashes and SHA-256 hashes of high-entropy opaque refresh tokens. Plain refresh tokens only appear in the HttpOnly cookie. An auth session has a fixed seven-day lifetime; rotation does not extend that lifetime. Pessimistic row locking makes refresh rotation single-use under concurrent requests. Reuse of an old refresh value returns 401; it does not revoke the newer session. Retired hashes in `retired_refresh_tokens` map pre-rotation cookies to their session for logout only, preventing an in-flight refresh response from undoing logout. Access JWTs carry a session ID; REST and inbound STOMP operations check persisted session status and account enablement. Logout revokes that session and closes its sockets after transaction commit.

All clients use one instance. A synchronized in-memory connection registry enforces five chat sockets per account, holds token-expiry timers and publishes presence only on first-connect/last-disconnect transitions. `lastSeen` is persisted; rooms, membership, messages, receipts, reactions and notifications use MySQL. Upload bytes use a Docker volume. Restart disconnects sockets and clears temporary rate-limit, presence and Lab state; persisted refresh sessions permit re-login restoration.

## Realtime security

`/ws` uses a native WebSocket transport with STOMP 1.2, without SockJS. HTTP Upgrade checks Origin; JWT authentication is at STOMP CONNECT. Browser WebSocket APIs cannot attach arbitrary Authorization headers to the HTTP handshake. An unauthenticated socket has five seconds to CONNECT and cannot SEND/SUBSCRIBE. Access token expiry closes the connection even without traffic. Subsequent frames also check account/session state. The F12 ban transaction disables the user and revokes all auth sessions, then disconnects sockets after commit. The isolated `/lab/ws` transport uses a first-frame authentication envelope and periodic session checks.

Clients subscribe to private user destinations, including session diagnostics, acks, room events, presence, typing, notifications and admin statistics. The [destination permissions](api/realtime.md#destination-permissions) restrict access; room operations enforce membership and admin operations check the current database role. Raw broker destinations and other users' queues cannot be addressed by clients. See [chat design](features/chat.md) for locking, delivery order and recovery boundaries.

The frontend uses the same origin in Docker, an in-memory token store and bounded reconnect. Successful proactive refresh replaces the socket with a new authenticated connection. Transient refresh errors preserve the local session and retry after five seconds; 401/403 clears it. Logout changes the session revision so a pending refresh cannot resurrect local state. Web Locks serialize cookie rotation across tabs where supported; on insecure LAN origins without Web Locks, simultaneous refresh in separate tabs may require one tab to sign in again.

## HTTP and deployment

Cookie-authenticated endpoints use POST, `SameSite=Strict`, HttpOnly and an Origin guard. The application is stateless for HTTP sessions; protected REST endpoints require Bearer tokens. Same-origin requests and configured exact extra origins are accepted. No forwarded-host headers are trusted. The default HTTP mode is for local/LAN demonstration; use HTTPS and secure cookies for Internet deployment.

MySQL is isolated on the Compose network by default. The optional Workbench overlay publishes only `127.0.0.1:3307`. Flyway owns schema changes; Hibernate uses `ddl-auto=validate`. Runtime runs as a non-root user. Credentials are generated locally and excluded from Git and the Docker context.

## References

- [Spring token authentication for STOMP](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/authentication-token-based.html)
- [Spring WebSocket message authorization](https://docs.spring.io/spring-framework/reference/web/websocket/stomp/authorization.html)
- [Spring Boot managed dependencies](https://docs.spring.io/spring-boot/3.5/appendix/dependency-versions/coordinates.html)
