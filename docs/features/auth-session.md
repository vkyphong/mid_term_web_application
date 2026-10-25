# F01/F02: authentication, authenticated realtime sessions and KP4

## Scope

F01 restricts registration to configured company email domains and issues short-lived access tokens with rotating refresh sessions. F02 extends that identity to the realtime channel: a STOMP connection is accepted only after the client presents a valid access token, and the connection does not outlive that token. Together they demonstrate KP4, security under concurrent persistent connections.

## Identity and session lifetime

Domain membership is decided by an exact comparison of the normalized part after the single `@`, not by substring or suffix matching. Consequently `user@evilDQGM.dev` and `user@DQGM.dev.example.com` are rejected. The frontend performs the same check for early feedback, while the backend remains authoritative.

Passwords are stored as BCrypt hashes. A successful login creates a persisted auth session with a fixed seven-day lifetime. The browser receives an opaque refresh value only in an HttpOnly, SameSite=Strict cookie scoped to `/api/auth`; the server stores its SHA-256 hash. Every refresh rotates the value under a row lock, so concurrent refreshes produce exactly one success. Access tokens are HS256 JWTs valid for 900 seconds and carry the session identifier, which allows logout to invalidate outstanding access tokens immediately. The frontend keeps the access token in memory only.

## Authenticated realtime connections

Browsers cannot attach an Authorization header to the WebSocket handshake. The HTTP Upgrade therefore checks only the Origin against an allow-list, and authentication occurs in the STOMP CONNECT frame, which carries `Authorization: Bearer <token>`. Tokens never appear in URLs or logs. A socket that does not complete CONNECT within five seconds is closed. Missing, malformed, expired or revoked tokens receive a STOMP ERROR with `unauthorized`; disabled accounts receive `forbidden`.

Each authenticated connection is bound to its token's expiry. The server schedules closure with status 1008 at that instant, even on an idle socket, and closes all sockets of a session on logout. Subsequent frames re-check session and account state. A synchronized in-memory registry limits each account to five concurrent connections; the sixth receives `rate_limited` with reason `connection_limit`. Clients may subscribe only to their own session, acknowledgement and event queues.

## Client behaviour at expiry

The client refreshes proactively, at the earlier of 60 seconds or 20 % of the token lifetime before expiry, and replaces its socket with one authenticated by the new token. If that refresh cannot complete, the server closes the old socket at expiry. The client then attempts one refresh per failure sequence and reconnects only after obtaining a new token; it never reconnects with the expired token. A rejected refresh ends the local session and returns the user to the sign-in page. Transient network errors preserve the session and retry after five seconds, and network reconnects stop after five consecutive failures, preventing reconnect storms.

## Verification

Backend integration tests (`AuthIntegrationTest`, 15 cases) use real WebSocket connections. They cover domain spoofing, duplicate registration, wrong passwords, refresh rotation and replay, concurrent refresh, logout revocation of cookies, tokens and sockets, rejected Origins, missing, tampered and expired tokens, banned accounts, frames sent before CONNECT, forbidden destinations, the five-connection limit, closure at token expiry and closure of idle unauthenticated sockets. A Node smoke test repeats the essential flows against MySQL in Docker.

The browser test `client/e2e/session.e2e.ts` runs the production build against the Docker backend started with `ACCESS_TTL_SECONDS=20`. It records every STOMP CONNECT frame, its bearer token and every CONNECTED, ERROR and socket-close event, and checks three scenarios:

1. Proactive refresh: a new token is obtained before expiry, a new socket connects with it, and no CONNECT uses the old token afterwards.
2. Missed refresh: refresh requests are made to fail until the first token has expired. The server closes the socket at expiry; once refresh succeeds the client reconnects, and every CONNECT after expiry carries the new token.
3. Rejected refresh: the client shows the session-expired notice on the sign-in page and makes no further connection attempts.

Measured on 25 October 2026 against the Docker backend on localhost with a 20-second access token (times relative to token issue):

| Scenario | Observation |
| --- | --- |
| Proactive refresh | New token at 16.0–16.1 s; new socket sent CONNECT with it within 0.1 s; 2 CONNECT frames, 0 ERROR frames |
| Missed refresh | Server closed the socket with 1008 "Access token expired" at 19.5–19.7 s; the only CONNECT after expiry used the new token (26.1 s); 0 ERROR frames |
| Rejected refresh | Sign-in page with the session-expired notice; exactly 1 CONNECT in total |

The missed-refresh scenario initially failed and exposed a client defect. STOMP.js 7 fixes the next reconnect delay when a connection is activated, so setting `reconnectDelay = 0` inside the close handler did not cancel the pending reconnect: three seconds after the 1008 closure the client sent CONNECT with the expired token and received `unauthorized`. The client now deactivates the STOMP client on 1008 and creates a new connection only after it obtains a new token. The scenario blocks refresh until three seconds after expiry, so it reproduces the defect deterministically; it failed in 2 of 2 runs before the fix and passed in every run after it.

Run locally with `ACCESS_TTL_SECONDS=20 docker compose up -d --wait app`, then `E2E_ACCESS_TTL_SECONDS=20 npx playwright test session` in `client`. CI runs the same steps after the channel tests.

## Limitations

Connection limits and expiry timers live in the memory of a single instance, which matches the single-instance architecture. An account disabled while holding an idle socket is blocked at its next frame or at token expiry; immediate disconnection on ban is part of F12. The HTTP deployment used for LAN demonstrations does not protect tokens in transit; Internet deployment requires HTTPS and secure cookies.
