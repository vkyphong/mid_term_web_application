# Protocol Lab — F13

Uses the [shared REST authentication and timestamp conventions](README.md#shared-conventions). The Lab is isolated from business chat. It compares HTTP polling, long polling, SSE and **raw WebSocket**, not STOMP. All transports return `{type:"lab:pong",payload,ts,sequence,correlationId?}` for the same `{type:"lab:ping",payload:{id,text?},ts,correlationId?}` input. `payload.id` is a string up to 64 characters; optional `correlationId` must be a nonblank string of 1–64 characters and is echoed in the pong as an application acknowledgment. The browser harness always provides it and validates the matching pong. The entire ping JSON is capped at 2048 UTF-8 bytes. Limit: 20 pings/second/auth session.

## REST and SSE

All requests require Bearer authentication. Each auth session has its own bounded event history (latest 256 events). Another login/session cannot read it. These are transient Lab events, not stored chat messages.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/lab/ping` | JSON ping body; enqueue and return its pong |
| `GET /api/lab/poll?after=0` | Immediate `{events,nextCursor,resetRequired}` |
| `GET /api/lab/long-poll?after=0` | Same shape, wait up to 25 seconds if no new events; max two pending requests/session |
| `GET /api/lab/sse?after=0` | `text/event-stream`, max two streams/session, lifetime 60 seconds |

`after` is a nonnegative sequence number from the same session. Advance it to `nextCursor`. A cursor greater than the latest sequence is invalid. When a consumer falls outside retained history, `resetRequired:true` explicitly indicates a gap.

SSE begins with a `ready` event whose data is the page shape above (including replay after the provided cursor). Subsequent named `lab:pong` events have SSE `id:<sequence>` and the pong JSON as data. Reconnect with `after` explicitly; `Last-Event-ID` alone is not used. Use streaming `fetch` to supply the Authorization header; native browser `EventSource` does not support a custom Bearer header. Tokens are never URL parameters. Session authorization is checked periodically; expired/revoked/banned sessions stop pending streams and requests. Reauthenticate/reconnect after expiry. Server restart loses Lab history.

## Raw WebSocket

Connect to `ws://host:8080/lab/ws` (or wss on an HTTPS deployment). Origin is checked. Within five seconds send:

```json
{"type":"lab:auth","payload":{"authorization":"Bearer ACCESS_TOKEN"},"ts":"2026-10-24T00:00:00Z"}
```

Success: `{type:"lab:ready",payload:{},ts}`. Then send ping envelopes directly, with no STOMP headers or NUL terminator. A pong arrives on the same socket. Max two authenticated Lab sockets/user, 4 KiB text frames, periodic expiry/revocation checks. Errors use `{type:"lab:error",payload:{error:{code,reason,message}},ts}`; auth errors close the connection. Never log the auth frame.

## Reproducible comparison

Run against the healthy Docker app:

```sh
docker compose --profile tools run --build --rm --no-deps --entrypoint node smoke smoke-lab.mjs
```

The script prints p50/p95/max and request/header estimates for each protocol. Each run uses 20 sequential messages, 128-byte text payload, target 250 ms interval, and a 100 ms polling interval. Setup/authentication is excluded from latency. The same test-runner monotonic clock measures from submitting a ping to receiving its pong through the selected delivery transport, avoiding clock skew. HTTP variants use POST to submit plus the selected GET delivery path; raw WS submits and receives on one socket. This makes their differing request costs explicit.

HTTP request counts include POST and delivery GETs. HTTP header byte estimates use the explicit request headers plus Host and actual response header pairs/status lines encoded as HTTP/1.1; they are not packet captures. WS frame overhead is estimated separately using payload lengths, client masking and extended lengths. The WS handshake is reported separately as one upgrade, with byte count excluded. Auth setup, payload bytes, HTTP chunk framing, TCP/IP and TLS overhead are excluded from header estimates; the script intentionally requires HTTP. Do not present these numbers as total wire traffic or production capacity.

## Browser Lab

The integrated browser UI is available at `/lab` for any authenticated user, including ordinary employees. It provides protocol selection, a shared configuration, sequential four-protocol execution, cancellation, latency/request/header charts, and a JSON export. Default browser workload: 20 messages, 128 text bytes, absolute 250 ms sending offsets, 100 ms continuous short polling, a five-second target sending window per protocol. Unlike the CLI smoke script, sending does not await each pong.

The browser uses `performance.now()` at submission and matching selected-path delivery, ignores POST-response pongs for HTTP variants, and uses streaming Fetch with Bearer authentication for SSE. A native WebSocket exchanges JSON with `/lab/ws`; STOMP is not used for Lab traffic. Existing chat STOMP traffic is outside the Lab counters.

Browser HTTP counters include the baseline cursor GET and SSE opening request. Their setup subset is also exported. Browser header bytes use an HTTP/1.1 text model of explicit request headers, Host/Content-Length, and Fetch-visible response headers. Browser-managed headers and WebSocket handshake bytes cannot be measured by this model. Frame overhead, HTTP body bytes, and WebSocket payload bytes are exported separately; TLS/TCP/IP/chunk framing/compression are excluded. Complete measurement definitions and KP1 discussion: [Protocol Lab design](../features/protocol-lab.md).
