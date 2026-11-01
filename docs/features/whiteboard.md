# Collaborative whiteboard (F19 / KP2)

## Scope

F19 adds a small shared drawing surface to existing channel and direct-message rooms. A room member switches between Chat and Whiteboard, chooses a pen color and width, and draws with mouse, pen or touch. Clear requires an explicit confirmation and affects the entire room. Layers, object manipulation, shared undo/redo, image editing, cursor tracking and a persistent offline queue are outside scope. The feature reuses the single authenticated chat STOMP connection; it does not introduce Socket.IO, a public room topic, Redis or another backend instance.

The [event contract](../api/whiteboard.md) was written before implementation. It defines normalized coordinates, bounded packets, membership, application acknowledgments, ordering, persistence, recovery and error codes. Browser rendering uses a fixed logical 1000×600 Canvas with a 5:3 display ratio. The 2D context requests `willReadFrequently` to retain the same software-oriented drawing path for previews, snapshot replays and verification readbacks; see [the HTML Canvas context settings](https://html.spec.whatwg.org/multipage/canvas.html). Each batch begins its own path; a one-point operation is a dot. Different authors' paths are never joined. Normalized coordinates preserve alignment across desktop and mobile viewports.

## State ownership and concurrency

Flyway migration V5 creates `whiteboards` and `whiteboard_segments` without modifying existing auth, chat or upload rows. MySQL owns accepted operations. A room has a generation and monotonically increasing revision. A segment contains a client UUID, authenticated author ID, generation, revision, color, width, bounded point array, and server timestamp. The primary key scopes duplicate detection to room, author and operation ID; the unique room/revision index defines accepted order.

Mutations acquire the actor row before the room row, matching chat's lock order and avoiding a foreign-key/user-lock inversion. Membership changes also serialize on the room row. Snapshots hold that room lock while reading metadata and ordered segments, so they cannot mix a pre-clear generation with post-clear content. A mutation validates current membership under the lock, commits state, then publishes to enabled current members' private queues. A notification accepted before departure can still be in flight; no system can recall pixels already viewed by a former member.

Distinct simultaneous operations receive successive revisions. Repeating identical content under the same current-generation operation key returns its original segment without another insert, revision increment or broadcast. Reusing that key for different content is rejected. Clear deletes current segments, increments both generation and revision, and records its most recent operation identity and revision. An immediate retry returns the original clear result. A delayed command from an older generation cannot restore erased strokes or erase a later board. The frontend ignores an older clear acknowledgment after newer operations have already been applied.

## Recovery and delivery guarantees

The client subscribes before requesting a snapshot and buffers operations received while the snapshot is loading. It replays buffered operations in server revision order, ignores duplicates and older acknowledgments, and reloads a snapshot when revisions or generations do not form a contiguous sequence. Buffer overflow forces a fresh snapshot rather than silently accepting a gap. No distributed exactly-once delivery guarantee is claimed: a database commit can succeed while the connection or acknowledgment fails.

The per-mounted-board outbox retains up to 32 segment operations, each with its original UUID. One request is in flight at a time and submissions are spaced by at least 200 ms. A network failure pauses drawing and retains uncertain operations. Reconnect or explicit Retry fetches authoritative state and resubmits the same UUID, allowing server deduplication to recover a lost acknowledgment. A clear generation invalidates obsolete queued work. Authorization rejection hides the loaded board and prevents drawing. Unsent local work is discarded on navigation; only server-persisted work is guaranteed after a full reload.

Clear has its own uncertain-operation identity: it is retried with the original expected generation and UUID, never silently transformed into a new clear of the current board. The confirmation warns that no undo exists. Clear is unavailable while the mounted board has pending segment work, reducing accidental loss of local edits.

## Bounded traffic and separation from chat

Each command envelope is at most 4096 UTF-8 bytes and each segment contains 1–48 finite normalized points. Color is a six-digit hex value; width is an integer from 1 to 12. The board is capped at 1000 stored segments until explicitly cleared. Its snapshot is therefore bounded. The existing 8 KiB STOMP frame and 32 KiB send-buffer limits remain unchanged.

Whiteboard commands use a separate 8-command/second/socket limiter. They do not consume the 10-message/5-second chat quota or the collaboration-action quota. Client batching targets five or fewer submissions per second and limits unacknowledged work, preventing a pointer event from becoming an unbounded socket stream. Drawing does not create chat messages, notifications, or changes to `last_message_at`, so Admin Dashboard message-rate and active-room statistics retain their documented definitions.

This is an interactive collaboration feature on a single process, not a production-scale whiteboard or load benchmark. The bounded snapshot and full Canvas repaint favor understandable correctness over advanced rendering and editing features. Existing MySQL backups include board state automatically; no extra volume is needed.

## Verification and KP2

KP2 is demonstrated by the selective dissemination of simultaneous authors' operations, deterministic server ordering, independent client rendering, and reconciliation after delivery interruption. Unit tests cover normalization and independent Canvas paths; snapshot/event races, duplicate acknowledgment/broadcast, gaps and membership denial; bounded outbox and pacing; same-ID reconnect retry; and clear-generation behavior.

Backend integration tests use real STOMP sockets and H2 in MySQL mode to cover authenticated snapshots, author derivation, deduplication, concurrent writers, generation conflicts, clear retries, packet/style/storage bounds, private delivery, departure/rejoin, and drawing limits independent from chat. Browser E2E uses three independent employee sessions on the real Docker/MySQL deployment. It compares server revisions and spatial RGBA tile sums with a small tolerance for Canvas GPU/CPU edge anti-aliasing; exact raster hashes are recorded only as references. It also tests room isolation and outsider denial, sends chat during drawing, reloads and reconnects, checks leave/rejoin, exercises a touch tap at 390px, and confirms room-wide clear followed by fresh drawing. Tests create dedicated accounts and rooms, preserving existing project data.

Optional screenshots and a JSON verification record are described in [F19 evidence](../evidence/f19/README.md). Automated checks do not replace peer review, optional-feature acceptance, or the report/video explanation. No commit, push or issue closure is performed automatically.
