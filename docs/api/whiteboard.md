# Collaborative whiteboard — F19 / KP2

This contract is defined before implementation. F19 is a small drawing surface inside an existing channel or DM, using the authenticated shared chat STOMP socket. Only current room members can read, draw, clear, or receive new operations. No new socket, public room topic, external service, or design-editor feature is introduced.

## State and bounds

`GET /api/rooms/{id}/whiteboard` returns `{roomId,generation,revision,segments}`. State persists in MySQL. `revision` increases for every accepted operation; `generation` increases on Clear. Segments are ordered by their server revision. A snapshot and each mutation serialize on the existing room row, as do membership changes.

Each segment is `{roomId,operationId,authorId,generation,revision,color,width,points,createdAt}`. Coordinates are normalized numbers in `[0,1]`, each point is `{x,y}`. The logical drawing surface is 1000×600; width is an integer from 1 to 12 in that coordinate system; color is a six-digit hex string. Each operation contains 1–48 points, at most 4096 UTF-8 envelope bytes, and a UUID `operationId`. A board contains at most 1000 segments; Clear is required before adding more. The client batches points, sends at most once every 200 ms, and keeps at most 32 unacknowledged segments per mounted board.

## Commands and events

All commands use `{type,payload,ts,correlationId}` and the existing session-specific `/user/queue/acks` application acknowledgments. STOMP RECEIPT is not a business acknowledgment. Subscribe to `/user/queue/whiteboard`; the server sends `{type,payload,ts}` only to current members' private queues.

| SEND | Type | Payload | Successful ack data / broadcast |
| --- | --- | --- | --- |
| `/app/whiteboard.segment` | `whiteboard:segment` | `{roomId,operationId,generation,color,width,points}` | The persisted Segment; broadcast type `whiteboard:segment` |
| `/app/whiteboard.clear` | `whiteboard:clear` | `{roomId,operationId,generation}` | `{roomId,generation,revision,operationId,authorId}`; broadcast type `whiteboard:cleared` |

Limits are independent of chat sends and collaboration actions: **8 whiteboard commands/second/socket**, including retries and invalid attempts after parsing the envelope. The client uses 5 or fewer commands/second and sends sequentially. HTTP snapshots are authenticated and membership checked. Errors follow `unauthorized`, `forbidden`, `invalid_payload`, and `rate_limited`. `invalid_payload/stale_board` means the generation changed; `invalid_payload/board_full` means the 1000-segment bound was reached. These require resynchronization or clearing, not blind retries.

## Retry, ordering and recovery

Deduplication is scoped to `(room,author,operationId)` within the current generation. Replaying identical content returns the original segment without incrementing revision or broadcasting twice. Reusing the ID for different content is rejected. The server derives author identity from authentication. Clear checks the expected generation, deletes current segments, increments generation and revision, and remembers its latest operation ID, author and revision so an immediate retry is harmless. An older clear or old-generation segment cannot erase or restore a newer board.

The frontend subscribes before fetching a snapshot, buffers events arriving during the fetch, merges by revision and resynchronizes on gaps/reconnect. Sender acknowledgments and broadcasts may arrive in either order and are deduplicated. An ambiguous network failure retains the original operation ID for an explicit retry. On Clear, obsolete queued segments are discarded. New drawing is disabled while disconnected or synchronizing. Leaving the board discards unsent local work; only acknowledged/server-persisted work is guaranteed after navigation or reload. Lost acknowledgments can be recovered by retrying the same ID while the board remains mounted.

Recipients are determined at acceptance time under the room lock, and publication occurs after commit. An event accepted before a member leaves can still be in flight; leaving prevents newly accepted operations from targeting that account. Previously viewed pixels cannot be recalled. There are no layers, object manipulation, shared undo/redo, raster uploads, cursor presence, or offline persistent queue.

KP2 is demonstrated by concurrent room-scoped dissemination, server-defined ordering, deduplicated acknowledgments, and snapshot recovery. Tests must cover concurrent drawing, outsider send/read denial and event isolation, leave/rejoin, duplicate delivery, clear-versus-delayed-draw races, persistence and reconnect, packet/rate bounds, and ordinary chat remaining usable during drawing.
