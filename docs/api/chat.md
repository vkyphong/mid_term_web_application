# F03 / F04 — Channels and direct messages contract (draft)

> Status: **draft proposed by FE**, to be confirmed by TV2 (BE) before implementation.
> FE (`client/src/features/chat/`) and its mock (`client/src/features/chat/mockChat.ts`) follow this document.
> Builds on [auth.md](auth.md) (REST Bearer auth) and [realtime.md](realtime.md) (authenticated STOMP session).

## Models

```ts
interface UserSummary { id: string; displayName: string; email: string }

interface Room {
  id: string
  type: 'channel' | 'dm'
  name: string                // channel: its name; dm: the other member's displayName
  description: string | null  // channel only
  memberCount: number
  joined: boolean             // requester is a member (always true for dm)
  peer: UserSummary | null    // dm only: the other member
  lastMessageAt: string | null // ISO-8601 UTC
}

interface Message {
  id: string
  roomId: string
  clientMsgId: string | null  // echoed from message:send, lets the sender reconcile its optimistic copy
  sender: { id: string; displayName: string }
  content: string             // plain text; clients render as text, never HTML
  createdAt: string           // ISO-8601 UTC, assigned by the server
}
```

## REST (Bearer access token)

| Endpoint | Body / query | Success |
| --- | --- | --- |
| `GET /api/rooms` | – | `200 { rooms: Room[] }`: every channel (with `joined`) + DMs the requester belongs to |
| `POST /api/rooms` | `{ name, description? }` | `201 Room` (type `channel`, creator auto-joined) |
| `GET /api/users?search=&limit=20` | `search` matches displayName or email, case-insensitive | `200 { users: UserSummary[] }`, excludes requester, max 20 |
| `POST /api/dms` | `{ userId }` | `200 Room` (type `dm`). **Idempotent**: one DM per pair, concurrent calls return the same room |
| `GET /api/rooms/{id}/messages?limit=30&before=` | F05 cursor pagination | `200 { messages: Message[], nextCursor: string \| null }`, oldest → newest |

Seed channels: **Engineering, HR, Sales, Marketing**.

Validation: channel `name` 2–40 characters after trim, unique case-insensitive; `description` ≤ 200 characters.

| Situation | HTTP | `code` | `reason` |
| --- | --- | --- | --- |
| Invalid body | 400 | `invalid_payload` | `validation` (+ `details`) |
| Channel name exists | 409 | `invalid_payload` | `room_name_taken` |
| DM with self / unknown user | 400 | `invalid_payload` | `validation` |
| History of a room the requester is not a member of | 403 | `forbidden` | – |
| Room not found | 404 | `invalid_payload` | `not_found` |

## STOMP

All frames use the authenticated session from F02. Envelope for every event: `{ type, payload, ts }`.

### Client → server (SEND)

| Destination | `type` | `payload` | Ack `data` |
| --- | --- | --- | --- |
| `/app/room.join` | `room:join` | `{ roomId }` | `Room` |
| `/app/room.leave` | `room:leave` | `{ roomId }` | `{ roomId }` |
| `/app/message.send` | `message:send` | `{ roomId, content, clientMsgId }` | `Message` |

Each SEND body also carries a client-generated `correlationId` (UUID):

```json
{ "type": "message:send", "payload": { "roomId": "r1", "content": "Hello", "clientMsgId": "c-123" },
  "ts": "2026-10-21T08:00:00Z", "correlationId": "5f1d…" }
```

Rules:
- `room:join` / `room:leave` apply to channels only; on a DM → `forbidden`.
- `message:send` requires membership → otherwise `forbidden`. `content` is trimmed, 1–2048 UTF-8 bytes (F11 may tighten).
- Resending the same `clientMsgId` in the same room must not create a duplicate (returns the original message). Needed by F10.
- The message is **persisted before** the ack is sent.

### Server → client

Subscribe once per connection (no per-room topics, so clients never subscribe to other rooms):

| Destination | Content |
| --- | --- |
| `/user/queue/acks` | Application acks, only to the sending session |
| `/user/queue/events` | Room events for every member of the room, all of their sessions |

Ack:

```json
{ "type": "ack", "payload": { "correlationId": "5f1d…", "ok": true, "data": { /* see table */ } }, "ts": "…" }
{ "type": "ack", "payload": { "correlationId": "5f1d…", "ok": false,
  "error": { "code": "forbidden", "message": "Not a member" } }, "ts": "…" }
```

`error.code` ∈ `unauthorized`, `rate_limited`, `invalid_payload`, `forbidden`. A STOMP RECEIPT is not an ack.

Events:

| `type` | `payload` | Sent to |
| --- | --- | --- |
| `message:new` | `Message` | Every current member of `roomId` (sender included), after commit |

Ordering: commit → ack to the sender's session → `message:new` to members. A user who left a channel receives no further `message:new` for it. A DM's `message:new` reaching a member who has never loaded it lets the client discover the new DM (it re-fetches `GET /api/rooms`).

## Client behaviour (FE reference)

- Optimistic send: a `sending` copy keyed by `clientMsgId`, replaced by the ack's `Message` or by the matching `message:new`, whichever arrives first; duplicates are merged by `id`.
- No ack within 10 s, or no connection → message marked `failed`, user can retry with the **same** `clientMsgId`.
- After a reconnect the client re-fetches rooms and open histories (events may have been missed while offline).
