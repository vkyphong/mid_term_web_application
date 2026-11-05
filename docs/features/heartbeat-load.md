# Heartbeats and load testing — F17 / F18 (KP1, KP4)

This document describes how PulseChat detects dead WebSocket connections (F17) and how a single Spring Boot instance behaves with 500 and 1000 concurrent STOMP connections (F18). All figures come from measured runs. The raw evidence is stored in [`docs/evidence/f17`](../evidence/f17) and [`docs/evidence/f18`](../evidence/f18).

## 1. Why heartbeats are needed (KP1)

WebSocket keeps one TCP connection open for the whole session. An orderly disconnect ends with a close frame, so the server can clean up immediately. Many real failures send nothing: a laptop goes to sleep, Wi-Fi drops, a mobile network changes cell, or a NAT entry expires. In these cases TCP itself may not report an error for minutes. Without an application-level liveness check the server keeps the session, the user stays "online" for their colleagues, and messages are pushed into a socket that nobody reads.

STOMP 1.2 solves this with heart-beating. In the `CONNECT` frame the client announces `heart-beat:cx,cy`: it can send a beat every `cx` ms and wants one every `cy` ms. The server answers with its own values in `CONNECTED`. A beat is a single end-of-line (`\n`) sent when no other frame was sent in the interval. This is different from the ping/pong control frames of RFC 6455. Those are handled by the WebSocket layer, are not visible to browser JavaScript, and cannot be sent from the browser API. STOMP heartbeats are ordinary data frames, so both the browser client and the server can observe them.

## 2. Design (F17)

| Item | Value |
| --- | --- |
| Heartbeat interval (both directions) | 5 000 ms, `app.heartbeat-ms` / `HEARTBEAT_MS` |
| Missed beats before a connection is considered dead | 3 (a common STOMP convention, also used by Spring's broker) |
| Read limit for a client announcing `heart-beat:5000,5000` | max(cx, server interval) × 3 = 15 000 ms |
| Watchdog sweep period | 1 000 ms |
| Expected detection time | 15–16 s; requirement ≤ 25 s |

- **Client** (`useRealtime.ts`, `@stomp/stompjs`): announces `heart-beat:5000,5000` and closes the socket itself when the server stops beating. It also reacts to the browser `offline` event immediately (F10).
- **Server**:
  - `WebSocketConfig` sets the simple broker heartbeat to the same interval.
  - `ConnectionRegistry` adds an explicit watchdog. Every inbound WebSocket frame, including a heartbeat newline, updates `lastReadAt` for that socket. At `CONNECT`, the announced `cx` turns on the read limit for that socket.
  - A sweep runs every second and closes sockets that have been silent longer than their limit. It removes them from the registry **before** sending the close frame, because a dead peer will never answer the close handshake.
  - Clients that announce `cx = 0` (no heartbeats, for example simple tools) are never closed for silence. This follows the STOMP negotiation rules.
- **Presence**: a user goes offline only when their *last* connection disappears. `presence:update { online:false, lastSeen }` is pushed to the remaining users at that moment. A user with one dead tab and one live tab stays online.

Why the watchdog was needed: with the previous 10-second heartbeat, Spring's broker would only notice silence after about 3 × 10 s, checked once per period, which is roughly 30–40 s. Presence also depended on the socket being fully closed. The explicit watchdog gives a deterministic bound that we can measure, and presence is cleaned up at the same moment.

### Measured result (blackhole test)

`scripts/smoke-heartbeat.mjs` reproduces a network blackhole:
1. Alice opens two tabs.
2. Tab B stops sending anything and never sends a close frame. Tab A keeps beating.
3. Then tab A goes silent too.
4. Bob observes presence throughout.

Three runs against the running Docker stack (5 s heartbeat):

| Run | Silent tab closed after | Alice still online with one live tab | Last tab → Bob receives `online:false` after |
| --- | --- | --- | --- |
| 1 | 15 880 ms | yes | 15 900 ms |
| 2 | 15 941 ms | yes | 15 962 ms |
| 3 | 15 903 ms | yes | 15 913 ms |

Worst case: **15.96 s ≤ 25 s** (pass). `presence:update` carried `lastSeen` every time. The backend test `HeartbeatIntegrationTest` checks the same behaviour on every build with a 1-second interval (limit 3 s): detection within 3–4.5 s, no false offline while another tab is alive, an offline event for the last tab, and no closure for clients without heartbeats.

## 3. Load test (F18, KP4)

### Method

`scripts/smoke-load.mjs` is a Node.js STOMP client that uses the same protocol as the browser: `CONNECT` with a JWT, 5 s heartbeats, application acknowledgements with `correlationId`, and events shaped as `{ type, payload, ts }`. It runs inside the Docker network (`smoke` service), so the numbers exclude the Windows port proxy.

1. **Seed.** Accounts `load-NNN@dqgm.dev` with 4 connections each (the server limit is 5 per user), grouped into rooms of 10 users. Accounts and rooms are reused on later runs.
2. **Ramp-up.** N connections are opened evenly over the ramp period. We record success and the time from socket open to `CONNECTED`.
3. **Steady state, 60 s, valid workload.** In every room one member sends one message per second, below the limit of 10 per 5 s per socket. Every message is fanned out to all connections of all room members. We measure the acknowledgement time for the sender and the delivery latency (send → `message:new`) for every other member's connection. Server statistics are read from the Admin API every 5 s, the same data as the Admin Live Dashboard.
4. **Spam workload.** One socket sends 30 messages in a burst. Another room sends one message right after, to check that other users are not affected.
5. **Recovery.** All sockets are closed, and we measure the time until the server's connection count returns to the baseline.

CPU and memory were sampled every ~4 s with `docker stats`. In `docker stats`, 100 % means one full CPU core.

**Environment:** Windows 11, Docker Desktop 29.8.2 (WSL 2 VM with 16 vCPU and 7.36 GiB RAM), one `app` container (Java 21, Spring Boot) and one MySQL 8.4 container. Load client: Node 22 in the same Docker network.

### Results

| Metric | 500 connections | 1000 connections |
| --- | --- | --- |
| Ramp-up | 30 s | 60 s |
| Connections established | **500 / 500 (100 %)** | **1000 / 1000 (100 %)** |
| Connect time p50 / p95 / max | 10 / 16 / 45 ms | 9 / 14 / 99 ms |
| Server-side connections (Admin API) after ramp-up | 501 (500 + 1 existing) | 1001 (1000 + 1 existing) |
| Rooms × rate | 13 rooms × 1 msg/s | 25 rooms × 1 msg/s |
| Messages sent / send errors | 781 / 0 | 1 501 / 0 |
| Deliveries (`message:new`) | 30 040 (100 % of expected) | 60 040 / 60 040 (100 %) |
| Sender ack p50 / p95 / p99 | 23 / 33 / 46 ms | 16 / 22 / 26 ms |
| **Delivery latency p50 / p95 / p99 / max** | 25 / **37** / 50 / 108 ms | 20 / **26** / 30 / 44 ms |
| Spam burst of 30 | 9 accepted, 21 `rate_limited` | 9 accepted, 21 `rate_limited` |
| Other room right after the burst | ack OK in 32 ms | ack OK in 15 ms |
| Recovery to baseline after closing all | 1.6 s | 1.8 s |
| App CPU average / peak | 66 % / 480 % | 89 % / 751 % |
| App memory start → peak | 499 → 759 MiB | 764 → 1 053 MiB |
| MySQL CPU average / memory peak | 10.7 % / 491 MiB | 15.6 % / 498 MiB |

### Interpretation

- **≥ 500 connections: met.** All 500 connections were established. Delivery p95 was 37 ms, with no lost or failed messages. 1000 connections, the survey level, also worked on this machine: 100 % of connections and deliveries, p95 26 ms. These are single-machine results for this workload only. They are not a capacity claim for production.
- **Latency is lower at 1000 than at 500.** The 1000 run followed the 500 run on a warm JVM, where JIT compilation and the connection pools were already initialised. The 500 run includes that warm-up. Both runs are reported as measured.
- **CPU peaks happen during seeding, not while holding connections.** Registering or logging in accounts runs bcrypt password hashing, which is intentionally expensive. During the steady phase the app used less than one core on average. Holding idle STOMP connections with 5 s heartbeats is cheap. The main cost is the fan-out: 25–40 deliveries for each message.
- **Memory.** Container memory rose by 260–290 MiB during each run, so well under 1 MiB per connection (sessions, buffers, subscriptions). The JVM heap is garbage-collected, so this is an upper bound, not an exact cost per connection. MySQL memory and CPU stay almost flat, because each message is persisted once whatever the fan-out.
- **Rate limiting works under load.** The limit is 10 messages per 5 s per socket. A burst of 30 is cut to 9 accepted messages, because the steady-state traffic had already used part of the window. The others receive `rate_limited` acknowledgements. Other rooms are not slowed down.
- **No double counting.** The connection counts reported by the Admin API exactly match the client-side totals: N plus one connection that already existed (an open browser tab).

### Limitations

- One instance, in-memory presence and a simple broker. Horizontal scaling (F16) is out of scope.
- The client and the server share the same physical machine, so their CPU usage affects each other.
- Message sizes are small text, and file uploads are not part of the load.
- The heartbeat test simulates a blackhole by stopping all client output. It does not drop packets at the network layer.

## 4. How to reproduce

```powershell
docker compose up --build -d --wait
# F17: three blackhole runs (≈ 1.5 min)
docker compose --profile tools run --build --rm --no-deps -e BASE_URL=http://app:8080 --entrypoint node smoke smoke-heartbeat.mjs
# F18: 500, then 1000 connections (≈ 3 min each); add -e STEADY_SECONDS=... to change the duration
docker compose --profile tools run --rm --no-deps -e BASE_URL=http://app:8080 -e CONNECTIONS=500 --entrypoint node smoke smoke-load.mjs
docker compose --profile tools run --rm --no-deps -e BASE_URL=http://app:8080 -e CONNECTIONS=1000 -e RAMP_SECONDS=60 --entrypoint node smoke smoke-load.mjs
```

Each script prints a JSON report to stdout and progress to stderr. Watch the Admin Live Dashboard (`/admin`, `admin@dqgm.dev`) during a run: the connection count rises to N and returns to the baseline afterwards.
