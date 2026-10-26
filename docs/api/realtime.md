# Realtime transport — F02

Uses the [shared API conventions](README.md). This document covers connection behavior; business payloads are defined in [chat](chat.md) and [collaboration](collaboration.md).

Transport: native WebSocket `/ws`, subprotocol `v12.stomp`. Docker uses `ws://<app-host>:8080/ws`; HTTPS uses `wss://`. Origin is checked at HTTP Upgrade. Authentication occurs at STOMP CONNECT, not at the HTTP handshake. No token in URL or logs.

```text
CONNECT
accept-version:1.2
host:localhost
Authorization:Bearer <accessToken>
heart-beat:10000,10000

\0
```

`\0` denotes the terminating NUL byte, not two literal characters. A valid, unexpired HS256 JWT with issuer `pulsechat`, an active auth session and an enabled account receives CONNECTED. Missing/malformed/expired/revoked tokens receive STOMP ERROR with `{ "error": { "code": "unauthorized", ... } }`, then disconnect. Banned users receive `forbidden`. Connection six for the same account receives `rate_limited` / `connection_limit`.

An unauthenticated socket is closed after five seconds. Authenticated sockets close at token expiry with code 1008. Logout closes sockets for the revoked auth session, not other independent logins. Client refreshes before expiry and reconnects with the new token. On unauthorized, frontend attempts refresh once per failure sequence; network reconnects stop after five failures. There is no offline queue in F02.

## Private connectivity probe

Subscribe to `/user/queue/session`, then SEND `{}` to `/app/session/ping`. The server replies only to the requesting session:

```json
{"type":"session:pong","payload":{"userId":"<authenticated-user-id>"},"ts":"2026-10-18T00:00:00Z"}
```

## Destination permissions

| SEND destination | Required permission |
| --- | --- |
| `/app/session/ping` | Authenticated session |
| `/app/room.join`, `/app/room.leave` | Channel operation; membership rules in chat |
| `/app/message.send` | Current room membership |
| `/app/typing.start`, `/app/typing.stop` | Current room membership |
| `/app/message.delivered`, `/app/message.seen` | Current member and original recipient |
| `/app/message.edit`, `/app/message.delete` | Current member and author |
| `/app/message.react` | Current room membership |
| `/app/admin.kick`, `/app/admin.broadcast` | Enabled admin account |

| SUBSCRIBE destination | Content |
| --- | --- |
| `/user/queue/session` | Session-specific connectivity probe |
| `/user/queue/acks` | Command acks for the sending socket |
| `/user/queue/events` | Messages and mutations for room members |
| `/user/queue/presence` | User presence transitions |
| `/user/queue/typing` | Typing events for room members |
| `/user/queue/notifications` | The account's notifications and read-state updates |
| `/user/queue/admin` | Admin-only statistics |

Other SEND/SUBSCRIBE destinations are denied. UNSUBSCRIBE and DISCONNECT are allowed. Business permissions are checked by the corresponding service; admin destination permissions are also checked at the protocol boundary.

## Transport limits

Frame limit is 8 KiB; send buffer limit is 32 KiB. Negotiated STOMP heartbeats use 10 seconds; blackhole detection timing is not claimed until F17 is measured. [Collaboration](collaboration.md#f11-limits) defines message-send and action limits.

Business events retain `{ type, payload, ts }`. Application acknowledgements use a correlation ID and follow successful database commit. Chat validation and membership failures return negative acks without closing the socket. A STOMP RECEIPT is only a transport-level receipt; it does not replace a business acknowledgement.
