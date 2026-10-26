# F03/F04: channels, direct messages and KP3

## Communication model

F03 implements group communication through persistent channels. Users discover channels, create new channels and explicitly join or leave them. Membership determines the recipients of every message. The creator becomes a member atomically with channel creation. Four initial departmental channels provide a consistent starting point without granting membership to every registered account.

F04 implements bilateral communication through a distinct room type. A direct-message room contains exactly two users and is identified by a canonical, ordered user pair. Both participants observe the same conversation regardless of which participant initiates it. The room list exposes only the requester's direct messages, and the history endpoint verifies membership before returning any content. Neither participants nor outsiders can use channel join/leave operations to alter a DM's membership.

These mechanisms demonstrate KP3 by combining authenticated persistent connections with selective message dissemination. A single authenticated STOMP connection carries private acknowledgements and room events. The server derives sender identity from the authenticated principal, rather than trusting client-supplied user identifiers. Client subscriptions cannot directly address other users or broker queues.

## Persistence and concurrency

Flyway migration V3 creates `rooms`, `room_members` and `messages`. V4 additionally enforces a global `(sender_id, client_msg_id)` retry key; cross-room reuse now fails explicitly. Unique indexes also protect normalized channel names and canonical DM pairs. The history index uses `(room_id, created_at, id)`. No existing auth tables are recreated.

Spring JDBC operations run within Spring-managed transactions. A DM transaction locks both user rows in identifier order before checking or inserting the room. Opposite-direction concurrent creation therefore yields one room with two members. The pair's unique index provides an additional database invariant. This is verified against MySQL by the smoke test, independently of the H2 integration tests.

Joining, leaving and sending acquire the room row lock. Sends first lock the sender row to serialize the global retry key across rooms. Membership authorization and message insertion occur within the same transaction. Repeating a send in the same room with the same sender's retry key returns the existing message without inserting or broadcasting another copy. A key from another sender does not suppress that sender's message. The frontend applies the same sender-scoped reconciliation rule.

## Delivery and recovery

The chat controller invokes the transactional service before publishing a successful acknowledgement. The service proxy completes the database commit before control returns to the controller. The acknowledgement targets only the originating STOMP session. A newly committed message is then delivered to every connected session of each current room member, including the sender's other sessions.

The existing inbound executor dispatches application messages on one thread, and the broker preserves publish order. In this single-instance scope, a leave acknowledgement precedes subsequent sends and the departed user is excluded from their recipient lists. Business validation failures return negative application acknowledgements while keeping the socket usable. Authentication failures and forbidden protocol destinations retain the F02 disconnection behavior.

Persistence and WebSocket delivery do not form a distributed transaction. A process failure after commit and before publication can prevent an immediate event from reaching a recipient. Reconnection invalidates the room list and active history, allowing clients to recover committed messages through REST. The current UI reloads the latest 30 messages; older history is accessible through the cursor API, while scroll-to-load UI and broader delivery guarantees belong to subsequent features.

## Verification procedure

Backend tests verify session-specific acks, member-only broadcasts, leave behavior, validation, retry deduplication, concurrent DM creation and history pagination with tied timestamps. MySQL smoke tests verify database-specific behavior; browser E2E exercises three users through the UI.

Commands, workload pacing, latency definitions and acceptance boundaries are maintained in [testing](../testing.md). The [chat contract](../api/chat.md) defines the frontend-facing behavior.
