# Chat — F03–F05 and F10

Uses the [shared API conventions](README.md) and [authenticated STOMP transport](realtime.md). This contract defines the canonical room and message models, including fields used by [collaboration](collaboration.md).

## Models

```ts
interface UserSummary { id: string; displayName: string; email: string }

interface Room {
  id: string
  type: 'channel' | 'dm'
  name: string                 // channel name or the other DM member's displayName
  description: string | null
  memberCount: number
  joined: boolean
  peer: UserSummary | null      // DM peer; null for channels
  lastMessageAt: string | null
}

interface Attachment {
  id: string
  filename: string
  mediaType: string
  size: number                 // bytes
  url: string                  // authenticated download path
}

interface Message {
  id: string
  roomId: string
  clientMsgId: string
  sender: { id: string; displayName: string }
  content: string               // plain text; empty for a file-only or deleted message
  createdAt: string
  editedAt?: string
  deletedAt?: string
  attachment?: Attachment
  receipts: { recipients: number; delivered: number; seen: number }
  reactions: { userId: string; emoji: string }[]
}
```

Optional message fields may be omitted. Message timestamps are assigned by the server. Receipt, deletion and attachment rules are in [collaboration](collaboration.md).

## REST

| Endpoint | Body / query | Success |
| --- | --- | --- |
| `GET /api/rooms` | — | 200 `{rooms: Room[]}`: all channels plus the requester's DMs |
| `POST /api/rooms` | `{name,description?}` | 201 `Room`; creator is joined |
| `GET /api/rooms/{id}/members` | Membership required | 200 `{members: UserSummary[]}`: current enabled members, used to choose F09 mention targets; non-member 403, unknown room 404 |
| `GET /api/users?search=&limit=20` | Case-insensitive name/email substring, limit 1–20 | 200 `{users: UserSummary[]}`; excludes requester and disabled users |
| `POST /api/dms` | `{userId}` | 200 `Room`; idempotent even on concurrent creation |
| `GET /api/rooms/{id}/messages?limit=30&before=` | Limit 1–100, optional opaque cursor | 200 `{messages: Message[],nextCursor: string \| null}` |

Seed channels: **Engineering, HR, Sales, Marketing**, inserted once by Flyway. New accounts are not automatically joined. The UI loads the latest page and fetches older pages with `before` when the reader scrolls up (F05, see [history](../features/history.md)). Cursors bind the room ID and the oldest returned `(createdAt, id)` pair, avoiding gaps or duplicates when timestamps tie. Invalid query types, out-of-range limits or malformed/cross-room cursors return `invalid_payload` / `validation`.
Flyway seeds Engineering, HR, Sales and Marketing once. New accounts choose which channels to join. Channel names are trimmed, 2–40 characters and unique case-insensitively; descriptions are at most 200 characters. A DM has exactly two fixed participants; channel join/leave operations cannot change them.

### History pagination

History requires membership. The cursor binds the room and oldest returned `(createdAt,id)` pair, avoiding duplicate or missing records when timestamps tie on a stable dataset. Each page is oldest-first; `nextCursor:null` means there are no older records. Prepend older pages and merge realtime/history by message ID.

## STOMP commands

| Destination | Type | Payload | Ack data |
| --- | --- | --- | --- |
| `/app/room.join` | `room:join` | `{roomId}` | `Room` |
| `/app/room.leave` | `room:leave` | `{roomId}` | `{roomId}` |
| `/app/message.send` | `message:send` | `{roomId,content,clientMsgId,mentions?,uploadId?}` | `Message` |

Include `correlationId` and `ts` using the [command envelope](README.md#realtime-envelopes-and-acknowledgements).

```json
{
  "type": "message:send",
  "payload": {
    "roomId": "9f3a3d4b-072a-47be-96b2-c845d3529034",
    "content": "Hello",
    "clientMsgId": "b5d9f175-3126-456f-9f87-82616b6df073"
  },
  "ts": "2026-10-25T00:00:00Z",
  "correlationId": "4ac2f71b-0d87-4c3e-a211-dfb64d910e71"
}
```

Join/leave are channel-only operations. Sending requires current membership. Content is trimmed and capped at 2048 UTF-8 bytes; nonblank content is required unless attaching a file. See [mentions](collaboration.md#f09-notifications-and-mentions), [uploads](collaboration.md#f15-files) and [rate limits](collaboration.md#f11-limits) for their additional rules.

### Retry and offline recovery

`clientMsgId` must be a UUID unique per sender across all rooms. Retrying the same ID in the same room returns the existing persisted Message without another insert, notification or broadcast. Reuse in another room fails with `invalid_payload/validation`. Another sender's identical UUID is independent.

Keep the original ID and payload when retrying. A duplicate ID does not edit an existing message. The sender receives a successful ack after commit; a new message is then published as `message:new` on `/user/queue/events` to all current members' connected sessions, including the sender. A user who has left is excluded from subsequent sends.

Subscribe to `/user/queue/acks` for command results and `/user/queue/events` for messages and mutations. Additional notification/mutation events can arrive before their command ack. Acks are matched by correlation ID; optimistic messages are reconciled by sender/clientMsgId and persisted ID.

The broker does not replay offline events. After reconnect, resubscribe and fetch rooms and open histories again. The existing chat UI loads the latest 30 messages and provides retry after a 10-second ack timeout; scroll-to-load and the F10 offline queue are separate FE work.

## Errors

| Situation | HTTP (REST) | Code / reason |
| --- | --- | --- |
| Invalid body/query, limit or malformed/cross-room cursor | 400 | `invalid_payload/validation` |
| Existing channel name | 409 | `invalid_payload/room_name_taken` |
| DM with self or unknown/disabled user | 400 | `invalid_payload/validation` |
| Nonmember reads history or sends a message | 403 | `forbidden` |
| Missing room | 404 | `invalid_payload/not_found` |
| Join/leave a DM | — | Negative ack with `forbidden` |

Business errors on these destinations return negative acks and keep the connection usable. A missing correlation ID produces an ack with an empty correlation ID, so no valid pending command can match it. Invalid authentication or denied protocol destinations use the [STOMP error behavior](realtime.md).
