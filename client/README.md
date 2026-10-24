# PulseChat client

React + TypeScript + Vite, TanStack Query, React Router, Zod and StompJS. Feature folders separate authentication and realtime; `lib/` contains shared HTTP/error/token infrastructure.

The supported full-stack workflow is Docker: see [root README](../README.md). React is built into Spring Boot static resources, so REST and WebSocket use the browser origin.

For optional local frontend development:

```sh
npm ci
npm run dev
```

Vite proxies `/api` and `/ws` to `http://localhost:8080`. Configure `VITE_API_PROXY_TARGET` if needed. `VITE_ALLOWED_EMAIL_DOMAINS` must match backend `ALLOWED_EMAIL_DOMAINS` (default `DQGM.dev`). `VITE_USE_MOCK_API=true` enables the old browser-only auth mock; realtime is disabled in this mode. Do not use real credentials with mock storage.

```sh
npm test
npm run lint
npm run build
```

Auth access tokens stay in memory. Refresh cookies are issued by Spring Boot. REST consumers use `authRequest`; websocket consumers use the realtime feature. [REST contract](../docs/api/auth.md), [STOMP contract](../docs/api/realtime.md).

## Chat (F03 / F04)

`features/chat` implements channels and direct messages against the implemented [chat contract](../docs/api/chat.md):

- `RealtimeProvider` opens the single STOMP connection; `realtimeBus` shares the connected client.
- `transport.ts` sends `{ type, payload, ts, correlationId }` and resolves on the matching application ack (`/user/queue/acks`, 10 s timeout); `/user/queue/events` delivers `message:new`.
- `hooks.ts` keeps rooms and messages in the TanStack Query cache; sends are optimistic (`clientMsgId`), failed sends can be retried with the same `clientMsgId`.

Mock mode (`VITE_USE_MOCK_API=true`) also mocks chat. Each browser tab holds its own login, so several tabs can chat with each other (events cross tabs via `BroadcastChannel`). Demo accounts `phong@<domain>` and `an@<domain>`, password `Demo1234`, exist for trying direct messages.

Docker always builds with mock mode disabled. Channels, DMs, membership and messages use the real backend and MySQL. History initially loads the latest 30 messages; the API supports cursors, while scroll-to-load UI belongs to F05. UUID generation falls back to `crypto.getRandomValues` on HTTP LAN origins.

With the Docker application healthy at `http://localhost:8080` and the default `DQGM.dev` email domain:

```sh
npx playwright install chromium
npm run test:e2e
```

The Playwright test uses three independent Chromium contexts, creates test accounts/channels, and verifies channel membership, private DMs, persisted history, reconnect and localhost message latency. Its workload is 20 sequential messages between two members, with a third user connected; p95 STOMP SEND-to-receiver-frame latency must be below 200 ms. Unit tests use mocks; this browser test requires the real backend. Screenshots, video and traces are disabled, and scratch output is outside the repository with `preserveOutput: never`.
