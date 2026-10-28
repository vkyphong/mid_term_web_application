# API reference

## Contracts

| Contract | Features |
| --- | --- |
| [Authentication](auth.md) | Register, login, refresh, logout and current user |
| [Realtime transport](realtime.md) | STOMP connection, authentication and destination permissions |
| [Chat](chat.md) | Room/message models, channels, DMs, history and message sending |
| [Collaboration](collaboration.md) | Presence, typing, receipts, notifications, limits, admin, edits, reactions and uploads |
| [Protocol Lab](lab.md) | Polling, long polling, SSE and raw WebSocket |
| [Whiteboard](whiteboard.md) | Room-scoped F19 drawing, snapshots, generation/revision and private delivery |

Contracts describe the implemented backend. Frontend integration of the F05–F15 additions is tracked separately. For commands to run the application and tests, see [operations](../operations.md) and [testing](../testing.md).

## Shared conventions

The default base URL is `http://localhost:8080`. Protected REST endpoints require `Authorization: Bearer <accessToken>`. Auth endpoints use credentials or the refresh cookie as described in [auth](auth.md). REST bodies are JSON unless an endpoint specifies multipart or streaming content. Successful endpoints with no body must not be parsed as JSON.

Times are ISO-8601 UTC. Treat IDs and pagination cursors as opaque strings; fields explicitly requiring a UUID must contain a valid UUID. Optional object properties can be omitted by JSON serialization; fields documented as nullable may also be `null`.

### Realtime envelopes and acknowledgements

Connect to `/ws` with the Bearer header in STOMP CONNECT. Business commands use `{type,payload,ts,correlationId}`; events use `{type,payload,ts}`. The connectivity probe in [realtime](realtime.md) has a separate empty request body. UUIDs are recommended for `correlationId`; the backend accepts a nonblank string up to 128 characters. `clientMsgId` specifically requires a UUID.

```json
{
  "type": "message:seen",
  "payload": { "messageId": "c1a92b0a-5745-44da-9a3b-9e1784ce2280" },
  "ts": "2026-10-25T00:00:00Z",
  "correlationId": "4ac2f71b-0d87-4c3e-a211-dfb64d910e71"
}
```

Subscribe to `/user/queue/acks` before sending commands. Match acks by `payload.correlationId`; related events may arrive before an ack. The ack is private to the originating socket. A STOMP RECEIPT does not confirm a business transaction.

```json
{
  "type": "ack",
  "payload": {
    "correlationId": "4ac2f71b-0d87-4c3e-a211-dfb64d910e71",
    "ok": true,
    "data": { "roomId": "9f3a3d4b-072a-47be-96b2-c845d3529034" }
  },
  "ts": "2026-10-25T00:00:00Z"
}
```

The `data` shape depends on the command. Successful mutation acks follow database commit; network delivery is not durable. After reconnect, reload REST snapshots and merge records by ID.

### Errors

REST errors use:

```json
{
  "error": {
    "code": "invalid_payload",
    "reason": "validation",
    "message": "Invalid request",
    "details": [{ "field": "content", "message": "Message must contain 1–2048 UTF-8 bytes" }]
  }
}
```

Negative application acks use the same error object:

```json
{
  "type": "ack",
  "payload": {
    "correlationId": "4ac2f71b-0d87-4c3e-a211-dfb64d910e71",
    "ok": false,
    "error": { "code": "forbidden", "message": "Room membership required" }
  },
  "ts": "2026-10-25T00:00:00Z"
}
```

The error codes are `unauthorized`, `forbidden`, `invalid_payload` and `rate_limited`. `reason` and `details` are optional. REST status distinguishes validation (400), authentication (401), authorization (403), missing resources (404), conflicts (409), oversized uploads (413) and limits (429); consult each endpoint for its exact behavior. Business validation errors keep STOMP usable. Authentication failures and forbidden protocol destinations produce ERROR/disconnect instead of normal command acks. Invalid JSON or oversized frames may fail before an application ack can be generated.

Message content is plain text. Render it as text in the frontend; do not interpret it with `innerHTML` or `dangerouslySetInnerHTML`. File transfer and download access are covered in [collaboration](collaboration.md#f15-files).

## Frontend integration order

1. Authenticate, connect STOMP, and subscribe to acks/events and the feature queues required by the UI.
2. Fetch room, history, presence and notification snapshots; reconcile events received during loading by record ID.
3. Keep `clientMsgId` and payload stable across retries. Re-fetch snapshots after reconnect.
4. Add typing TTL, visibility-based receipts and in-place message mutation updates.
5. Upload through REST before referencing `uploadId` in a message; handle REST and negative-ack errors consistently.
