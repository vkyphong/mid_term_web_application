# F02 — authenticated STOMP session

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

All other SEND/SUBSCRIBE destinations are denied. Client may UNSUBSCRIBE and DISCONNECT. Frame limit is 8 KiB; send buffer limit 32 KiB. Negotiated STOMP heartbeats use 10 seconds; blackhole detection timing is not claimed until F17 is measured.

For future business events retain `{ type, payload, ts }`. Application acknowledgements must use a correlation ID and follow successful database commit. A STOMP RECEIPT is only a transport-level receipt; it does not replace a business acknowledgement.
