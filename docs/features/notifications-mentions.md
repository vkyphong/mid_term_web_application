# F09: realtime notifications and mentions (KP2, KP3)

## Scope

F09 informs a user, without a page reload, when they are mentioned in a channel or receive a direct message, and lets them jump to the conversation. It illustrates KP2, a realtime use case whose value is immediacy, and KP3, server push to one specific user rather than to a room.

## Choosing mentions

The server does not parse `@name` text. The client sends the identifiers of the mentioned users in `message:send.mentions`, and the server rejects the message if any of them is not a current member of the room. To make that rule usable, the client needs the room's membership, which the original API did not expose; `GET /api/rooms/{id}/members` was added for this purpose and is restricted to members.

Typing `@`, or pressing the *@* button in the composer toolbar, opens a list of up to six members, matched on the start of any word of the display name with Vietnamese diacritics ignored. The author and disabled accounts are excluded; the members endpoint returns disabled accounts too, with `enabled: false`. In channels the list starts with *@All*, which notifies the whole group: when the message is sent it expands to the IDs of every active member except the author. The server accepts at most 20 mentions per message, so in larger groups individually picked members are kept first and *@All* reaches the first 20 members in name order. Arrow keys, Enter or Tab select a member and insert `@Display Name`. When the message is sent, only users whose `@Display Name` still appears in the text are included, so deleting an inserted name also removes the mention. Rendered messages highlight `@Display Name` tokens of room members, with a stronger highlight for the reader's own name; the content remains plain text.

## Delivery and presentation

Notifications are persisted by the server and pushed on the private queue `/user/queue/notifications` as `notification:new`; reading one emits `notification:read` to all of that user's sessions. The client keeps the first page from `GET /api/notifications` in the TanStack Query cache, prepends new notifications unless the identifier is already present, and decrements the unread count only when a notification changes from unread to read. Duplicate events from several tabs or from retried sends therefore cannot inflate the count, and reading in one tab clears the badge in the others. The snapshot is reloaded after every reconnect because the broker does not replay missed events.

A bell in the header shows the unread count and a panel with recent notifications. A toast appears for each new unread notification unless its room is the one currently open in a visible tab. Opening a notification marks it read and navigates to its room only if the reader still belongs to it; a newly created direct message that is not yet in the cached room list triggers a direct REST lookup first. System notifications from F12 have no room and are shown without a link.

## Unread counts and sound

Every room in the sidebar shows a red circle with the number of unread messages from other people, written as *5+* from five messages upwards, and the room name turns bold. The tab title shows how many rooms have unread messages. The server has no unread-count API, so the client keeps a per-room read mark (the server timestamp of the last message seen) and the IDs of unread messages in `localStorage` per user, which the `storage` event keeps in sync between tabs. Counting IDs rather than events means that repeated `message:new` events cannot inflate the number. Messages that arrive while the app is closed are counted after the next start: for each room whose `lastMessageAt` is newer than its read mark, the client loads the latest page of 30 messages, which is enough for a display capped at *5+*. Opening a room in a visible tab clears its count. A room without a read mark, for example on first use, takes its last message as the mark so old history does not show up as unread.

A new message from someone else in a room that is not on screen plays a short two-tone chime generated with the Web Audio API, so no audio file is shipped. Browsers allow audio only after the user has interacted with the page, so the audio context is opened on the first click or key press. When several tabs are open, only one plays the sound: a visible tab plays immediately, hidden tabs wait 150 ms and skip a message ID that has already been played. A speaker button in the header mutes or unmutes the sound for that browser.

## Verification

Measured on 27 October 2026 with `client/e2e/collaboration.e2e.ts` against the Docker backend, three users in independent browser contexts:

| Check | Observation |
| --- | --- |
| Mention selection | Typing `@` and part of a name listed the member; the sent message carried the highlighted `@Display Name` |
| Push without reload | The mentioned user saw a toast and an unread count of 1 in two open tabs |
| Isolation | A third member of the same channel who was not mentioned received no notification |
| Navigation and read sync | Clicking the toast opened the channel and cleared the badge in both tabs |
| Direct message | A DM produced *Tin nhắn riêng mới*; opening it from the bell navigated to the new DM |
| Stability | 8 of 8 repeated runs passed after fixing the race described below |

Unit tests cover mention detection, filtering, insertion, resolution and highlighting, and the cache rules for duplicate and cross-tab events. The browser test exposed two defects that were fixed: the caret was repositioned on the next animation frame after inserting a mention, so fast typing landed in the wrong place; and opening a notification for a brand-new DM could fail because the room-list refetch was cancelled by the arrival of that DM's first message.

## Limitations

The bell shows the most recent 30 notifications; older ones remain available through the cursor API but have no paging UI. Mention candidates are limited to current members. Browser notifications while the tab is hidden belong to F21.
