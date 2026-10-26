# Backend collaboration features F05–F15

## State ownership and key points

F05 demonstrates KP1 through persistent storage and stable cursor retrieval. F06–F09 and F14 demonstrate KP3 through selective dissemination of presence, typing, receipts, notifications and message mutations. F10–F12 demonstrate KP4 through retry semantics, authenticated access control, bounded input and administrative session revocation. F13 exposes four distinct transport mechanisms for a controlled KP1 comparison. F15 separates binary HTTP transfer from realtime metadata delivery, illustrating KP1 and KP3 without sending large files through the message broker.

The implementation remains a single Spring Boot process. Features are separated into `chat`, `presence`, `notification`, `admin`, `upload`, `lab`, `auth` and `realtime` packages. Spring-managed transactions coordinate SQL changes. No distributed cache, reverse proxy, multi-server routing or external object store is required.

## Persistence, retry and authorization

Migration V4 adds receipts, reactions, notifications, uploads and lifecycle timestamps without recreating existing tables. A unique sender/client-message key enforces retry identity across all rooms. Sender-row locking serializes simultaneous retries, then room locking serializes membership-sensitive changes. Existing cross-room collisions prevent migration rather than silently rewriting historical IDs. Legacy messages are retained; recipient snapshots are created for new messages only, because original historical membership cannot be reconstructed reliably.

Each new message captures the recipient set excluding its author. Receipt transitions use `COALESCE` so delivered/seen timestamps never regress; seen implies delivered. Only the authenticated recipient can update their own receipt and only while currently authorized for the room. Message creation, recipient records, attachment association and notifications commit atomically. Retrying an existing message produces no additional notifications or publication. Unique reaction keys and explicit add/remove intent provide idempotency. Authors retain edit/delete authority only while they remain room members; deletion preserves a tombstone and disables attachment access.

Notifications are durable personal records. Database checks hide room notifications after membership loss. Read-state changes publish to the recipient's other tabs. Presence, typing and rate windows are deliberately ephemeral. Presence counts sockets rather than tabs inferred by the client; typing expires in the UI after three seconds without an update. The backend derives identity exclusively from the authenticated principal.

## Delivery guarantees

Database commit and socket delivery are not an atomic distributed transaction. Realtime publication is deferred until successful commit, but a process/network failure can still interrupt publication. The API therefore promises persisted state and retry deduplication, not exactly-once network delivery. Frontends recover by fetching history, notification and presence snapshots after reconnect, merging by stable IDs. Mutation events can precede the command ack; correlation IDs are required. The existing single application dispatch thread preserves order for chat commands on this instance.

## Administration and transport isolation

Admin checks read current database roles rather than trusting a stale token role claim. Banning disables login and invalidates all persisted sessions before closing live sockets. Kick is a transient disconnection and does not permanently prevent reconnect. Statistics define their observation windows explicitly; they do not claim cluster-wide visibility. Broadcasts are stored as system notifications, including for offline enabled accounts.

The Lab has separate authentication-scoped histories and transport endpoints. Polling is immediate retrieval, long polling holds a bounded asynchronous request, SSE streams named events, and raw WebSocket exchanges JSON directly. Buffer sizes, connection counts, timeouts and authorization checks bound resource lifetime. The benchmark uses one monotonic clock and a common payload/workload. Header and frame overhead estimates are identified as estimates, not wire captures; no production-scale throughput claim is made.

## File lifecycle and security boundary

Upload accepts authenticated multipart requests after checking room membership. Random server IDs are used as filenames, avoiding user-controlled paths. Signature validation distinguishes supported types; images are decoded with a dimension limit. PDF signature checks do not replace malware scanning. File metadata resides in MySQL and bytes in the Docker upload volume. An upload can be associated with one sender-owned message in the same room. Downloads require current membership, deny unpublished files to nonowners and deny deleted-message files.

Files are served as attachments with `nosniff`, sandbox and no-store headers. Message content remains plain text; client HTML interpretation is outside the backend's control and is explicitly prohibited by the integration contract. Unsent files are retained rather than removed by an implicit cleanup policy. Operators back up both the database and upload volume.

## Verification and acceptance boundary

Backend integration tests cover real STOMP connections, auth/chat regressions, recipient permissions, monotonic receipts, notification visibility, concurrent retries, rate windows, oversized frames, upload bounds, mutation authorization, presence, admin actions and asynchronous Lab polling. MySQL smoke scripts verify the deployed HTTP/STOMP/SSE/raw WebSocket paths. See [testing](../testing.md) for commands and scope, and [backlog](../backlog/README.md) for frontend/review acceptance responsibilities.
