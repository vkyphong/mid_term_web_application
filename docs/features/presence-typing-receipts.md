# F06–F08: presence, typing indicators, delivery receipts and KP3

## Scope

F06 shows whether colleagues are online and when they were last active. F07 shows who is composing a message in the open room. F08 tells a sender whether a message has been delivered to and seen by its recipients. All three are server-pushed events on the authenticated STOMP connection, and together they illustrate KP3: events whose value lies in being broadcast promptly to exactly the users entitled to them, and in being cheap enough to send continuously.

## F06 presence

The server counts authenticated chat sockets per user. A user becomes online with the first socket and offline only when the last one closes; closing one of several tabs therefore changes nothing. On the transition to offline the server stores `lastSeen` in MySQL and pushes `presence:update {userId, online, lastSeen}` to every connected user.

The client loads a snapshot from `GET /api/presence` and applies each update to that snapshot in the TanStack Query cache, replacing the entry for the user rather than appending, so repeated or reordered updates cannot create duplicate state. The snapshot is reloaded after every reconnect, because updates sent while the client was disconnected are lost. Presence appears as a dot on direct-message avatars, as text in the direct-message header ("Đang hoạt động", "Hoạt động 5 phút trước") and in a colleague list sorted with online users first. The online count is computed from the full snapshot, while names come from the user search endpoint, which returns at most 20 people.

## F07 typing indicators

Sending an event per keystroke would multiply traffic by typing speed. The client instead sends `typing:start` when the user starts typing and repeats it at most every 2 seconds while typing continues. It sends `typing:stop` after 2.5 seconds without input, when the message is sent, when the input is cleared and when the user leaves the room. The server checks room membership, derives the user from the authenticated principal and forwards the event only to the room's members.

Each event carries `ttlMs: 3000`. Receivers display the indicator until a stop event arrives or three seconds pass without a refresh. Because the 2-second refresh interval is shorter than the 3-second lifetime, the indicator stays steady while someone types, yet disappears on its own if a stop event is lost, for example when the typist's connection drops. A new message from the typist also clears the indicator. Indicators from the user's own other tabs are ignored. Typing state is never persisted.

## F08 delivery and read receipts

When a message is stored, the server records its recipients as the room's members at that moment, excluding the sender. Only those recipients may acknowledge it, and acknowledgements are idempotent and monotonic: `seen` implies `delivered`, and a later `delivered` never lowers a `seen`. Every message carries counts `{recipients, delivered, seen}`, and each acknowledgement pushes the updated message to the room, where the client replaces it by identifier.

The client sends `message:delivered` when a message from someone else arrives over the socket. It sends `message:seen` only when the message is actually observable: the tab is visible (`document.visibilityState`) and at least 60 % of the message lies inside the conversation's scroll area, measured with an `IntersectionObserver`. Messages of a room that is not open are not rendered and therefore cannot be marked seen. Messages that scroll out of view while the tab is hidden are not counted when the tab becomes visible again.

The server allows 30 collaboration actions per 5 seconds per socket, shared with typing and message edits. Opening a room could otherwise produce one acknowledgement per visible message at once. The client therefore queues acknowledgements, sends at most one every 250 ms (20 per 5 seconds), never resends a level it has already had confirmed, lets a pending `seen` replace a pending `delivered`, skips messages whose counts show that every recipient has already acknowledged, and pauses for 5 seconds after a `rate_limited` response.

Display rules:

| Room | Shown under the sender's latest stored message |
| --- | --- |
| Direct message | *Đã gửi* (stored), *Đã nhận* (the recipient's client received it), *Đã xem* (the recipient saw it) |
| Channel | *Đã xem y/n* if anyone has seen it, otherwise *Đã nhận x/n*, otherwise *Đã gửi*; `n` is the number of recipients at send time. The time stamp's tooltip shows both counts. A single viewer is never presented as "everyone has seen it". |

Users who join a channel after a message was sent are not recipients of that message and never send receipts for it. Delivery is acknowledged only for messages received while online; a recipient who was offline moves the message directly to *Đã xem* when they open the conversation.

## Verification

Measured on 26 October 2026 against the Docker backend on localhost with the browser test `client/e2e/realtime.e2e.ts` (three users in independent browser contexts):

| Feature | Observation |
| --- | --- |
| F06 | The direct-message header showed *Chưa hoạt động* before the peer ever connected, *Đang hoạt động* with one tab, still online after one of two tabs closed, *Vừa hoạt động* after the last tab closed, and online again after reconnecting; the presence snapshot then contained exactly one entry for that user. |
| F07 | Sixteen keystrokes over 4 seconds produced 2–3 `typing:start` frames; the receiver saw "… đang gõ…" and it disappeared within 5 seconds after typing stopped; a third user outside the room received no typing frames. |
| F08 | *Đã gửi* while the recipient was offline; *Đã nhận* once the recipient was online on another page, remaining so for 1.5 s because the conversation was not open; *Đã xem* after the recipient opened it; unchanged after a second recipient tab opened and reloaded; the sender's client sent no receipts for its own messages. |
| Stability | 3 of 3 repeated runs passed; the F03/F04 and F05 browser tests still passed. |

Unit and component tests cover the 2-second throttle, the 2.5-second stop, the 3-second expiry, room isolation and own-tab filtering with fake timers; the receipt queue rate (at most 20 commands in the first 5 seconds for 30 messages), deduplication, back-off after `rate_limited` and no retry after `forbidden`; the visibility rules with a simulated `IntersectionObserver` and hidden tab; presence snapshot updates; and the direct-message and channel labels. Writing the back-off test exposed a defect in the first implementation, which re-queued the receipt before pausing and so retried after 250 ms instead of 5 seconds. Server-side rules, including that a sender cannot acknowledge on a recipient's behalf, are covered by `CollaborationIntegrationTest` and `scripts/smoke-collaboration.mjs`.

## Limitations

Presence, connection counts and typing state live in the memory of a single server instance and reset when it restarts; `lastSeen` records the last observed disconnect, not a crash time. A connection that dies without closing is detected only by heartbeats (F17). The colleague list shows at most 20 names because it reuses the search endpoint. Receipts reflect what the browser reports; the server cannot verify that a person actually read a message.
