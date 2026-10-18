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
