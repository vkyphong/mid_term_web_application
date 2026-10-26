# F05: persisted message history and KP1

## Scope

F05 makes every chat message durable and lets a client read a room's past in bounded pages while new messages continue to arrive in real time. It demonstrates KP1, the division of labour between HTTP and WebSocket: history is a request/response resource fetched over REST, whereas new messages are pushed over the persistent STOMP connection.

## Why two protocols

Reading history is a client-initiated, bounded, repeatable query. HTTP suits it: each page is an independent request with ordinary status codes, authentication and caching semantics, and it needs no per-connection server state. Delivering a new message is server-initiated and latency-sensitive; polling for it over HTTP would add a request per interval per client. The application therefore persists a message first, acknowledges the sender, and pushes `message:new` over WebSocket, while any client can reconstruct the same room state from REST at any time. The two channels must agree, so the client merges both sources by message identifier.

## Storage and pagination

Messages are stored in MySQL (`messages`, Flyway V3) with an index on `(room_id, created_at, id)`. `GET /api/rooms/{id}/messages?limit=30&before=` returns at most `limit` messages (1–100) from oldest to newest, plus an opaque `nextCursor`. The cursor encodes the room and the `(createdAt, id)` pair of the oldest returned message, and the next page selects rows strictly before that pair. Because the identifier breaks ties between equal timestamps, pages neither overlap nor skip messages on a stable data set, unlike offset pagination, which shifts when new rows are inserted. Membership is checked before any row is read; a user outside a direct message receives 403.

## Client behaviour

Opening a room loads the newest page. When the reader scrolls within 120 px of the top, or presses *Tải tin cũ hơn*, the client requests the page before the stored cursor using a TanStack Query mutation and merges it into the room's cached list. The scroll offset is increased by the height of the inserted content, so the message being read stays in place. A null cursor ends pagination and the list shows that the full history is displayed.

All writes to the cached list go through one merge function: an entry with an existing identifier replaces the old one, and a confirmed message replaces the sender's optimistic copy with the same `clientMsgId`. History pages, acknowledgements and `message:new` events can therefore arrive in any order without duplicates. After a reconnect the newest page is fetched again. If it overlaps the cached messages, older pages already loaded are kept; if the client missed more than one page while offline, the cache restarts from the newest page so that it never shows a list with a hidden gap.

## Verification

Measured on 26 October 2026 with the Docker application on localhost:

| Check | Result |
| --- | --- |
| Browser test `client/e2e/history.e2e.ts`: 45 messages sent in bursts of 10 per 5.2 s to respect the F11 limit of 10 messages per 5 s per socket; second user reopens the room | First request returned 30 messages (#16–#45); scrolling to the top loaded the older page; final list #1–#45 in order with no duplicates or gaps; a message pushed during the session appeared exactly once; scroll position preserved after insertion (offset > 200 px, not reset to the top) |
| Stability | 4 of 4 repeated runs passed (65 messages before F11); 2 of 2 after pacing for F11 |
| Persistence | 378 messages in MySQL before restarting the application container, 378 after |
| Unit and component tests | Merge across pages and live events, gap handling after reconnect, cursor pagination in the mock (30/30/5 pages), loading state, error and retry |

Backend pagination, including messages with identical timestamps, malformed or cross-room cursors and the 403 for non-members, is covered by `ChatIntegrationTest` and `scripts/smoke-chat.mjs`.

## Limitations

The client keeps every loaded page in memory and does not virtualise the list; very long sessions in one room grow the DOM accordingly. Pages are fetched only backwards from the newest message; jumping to an arbitrary point in history is out of scope.
