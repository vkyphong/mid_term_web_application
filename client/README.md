# PulseChat client

React + TypeScript + Vite, TanStack Query, React Router, Zod and StompJS. Feature folders separate auth, realtime and chat; `lib/` contains shared HTTP/error/token infrastructure.

The supported full-stack workflow is Docker: see [root README](../README.md). React is built into Spring Boot static resources, so REST and WebSocket use the browser origin.

For optional local frontend development:

```sh
npm ci
npm run dev
```

Vite proxies `/api` and `/ws` to `http://localhost:8080`. Copy `.env.example` to `.env.local` for overrides; the example file is not loaded automatically. `.env.test` supplies Vitest configuration. `VITE_API_PROXY_TARGET` changes the proxy target; `VITE_ALLOWED_EMAIL_DOMAINS` must match backend `ALLOWED_EMAIL_DOMAINS` (default `DQGM.dev`). `VITE_USE_MOCK_API=true` enables browser-only auth/chat mocks and disables the real WebSocket connection. Use demo credentials with mock storage.

```sh
npm test
npm run lint
npm run build
```

Auth access tokens stay in memory. Refresh cookies are issued by Spring Boot. REST consumers use `authRequest`; websocket consumers use the realtime feature. Start with the [API index](../docs/api/README.md) for REST, STOMP and integration order.

## Chat (F03 / F04)

`features/chat` implements channels and direct messages against the implemented [chat contract](../docs/api/chat.md):

- `RealtimeProvider` opens the single STOMP connection; `realtimeBus` shares the connected client.
- `transport.ts` sends `{ type, payload, ts, correlationId }` and resolves on the matching application ack (`/user/queue/acks`, 10 s timeout); `/user/queue/events` delivers `message:new`.
- `hooks.ts` keeps rooms and messages in the TanStack Query cache; sends are optimistic (`clientMsgId`), failed sends can be retried with the same `clientMsgId`.

Mock mode (`VITE_USE_MOCK_API=true`) also mocks chat. Each browser tab holds its own login, so several tabs can chat with each other (events cross tabs via `BroadcastChannel`). Demo accounts `phong@<domain>` and `an@<domain>`, password `Demo1234`, exist for trying direct messages.

Docker always builds with mock mode disabled. Channels, DMs, membership and messages use the real backend and MySQL. History initially loads the latest 30 messages; scrolling to the top (or **Tải tin cũ hơn**) loads older pages through the cursor API (F05). UUID generation falls back to `crypto.getRandomValues` on HTTP LAN origins.

## Feature handoff and E2E

F06–F08 (presence, typing, receipts) are integrated in `features/chat` (`presence.ts`, `typing.ts`, `receipts.ts`). F09–F11, F14 and F15 add `notifications.ts` and `components/NotificationCenter.tsx` (bell, toasts), `mentions.ts`, `outbox.ts` (ordered send queue, offline flush, lost-ack and rate-limit retries), `uploads.ts` and `components/AttachmentView.tsx`, and `components/MessageItem.tsx` (edit, delete, reactions). F12 is integrated at `/admin`. F13 is integrated at `/lab` for authenticated users; see the [collaboration](../docs/api/collaboration.md) and [Lab](../docs/api/lab.md) contracts.

## Protocol Lab (F13)

`features/lab/runner.ts` drives the four real transports with a shared absolute send schedule, selected-path latency, bounded cleanup, and explicit request/header/body/frame counters. `measurements.ts` defines nearest-rank percentiles, workload validation, HTTP/1.1 estimates, RFC 6455 frame estimates, and an incremental SSE parser. `ProtocolLab.tsx` provides the configuration, charts, results, cancellation, and JSON export. Lab is loaded as a separate route chunk and requires a real backend; it does not use chat mocks or STOMP.

Vite proxies both `/api/lab/*` and raw `/lab/ws` to `VITE_API_PROXY_TARGET`. The server's SPA route also supports direct reload at `/lab`. Read [the English measurement design](../docs/features/protocol-lab.md) before interpreting results, especially browser header visibility and the separation of WS handshake/payload/frame/TLS costs.

## Collaborative whiteboard (F19)

Joined rooms expose Chat and Whiteboard tabs. The lazily loaded `features/whiteboard/Whiteboard.tsx` renders normalized pointer strokes on a fixed logical Canvas. `model.ts` defines deterministic revision merging and independent paths; `session.ts` coordinates snapshot recovery, a bounded 32-operation outbox, 200 ms pacing, same-ID retry, clear generation and authorization failures. All events use the existing chat transport and `/user/queue/whiteboard`; mock mode explicitly requires the real backend.

Persistence and command bounds are described in the [F19 contract](../docs/api/whiteboard.md). Run `npm test -- src/features/whiteboard` for the local model/session tests or the real-browser `whiteboard.e2e.ts` scenario documented in [testing](../docs/testing.md).

See [browser E2E](../docs/testing.md#browser-e2e) for requirements, commands, pacing and latency definitions. Unit tests use mocks; E2E requires the real backend.
