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

`features/chat` implements channels and direct messages against the draft [chat contract](../docs/api/chat.md):

- `RealtimeProvider` opens the single STOMP connection; `realtimeBus` shares the connected client.
- `transport.ts` sends `{ type, payload, ts, correlationId }` and resolves on the matching application ack (`/user/queue/acks`, 10 s timeout); `/user/queue/events` delivers `message:new`.
- `hooks.ts` keeps rooms and messages in the TanStack Query cache; sends are optimistic (`clientMsgId`), failed sends can be retried with the same `clientMsgId`.

Mock mode (`VITE_USE_MOCK_API=true`) also mocks chat. Each browser tab holds its own login, so several tabs can chat with each other (events cross tabs via `BroadcastChannel`). Demo accounts `phong@<domain>` and `an@<domain>`, password `Demo1234`, exist for trying direct messages.
