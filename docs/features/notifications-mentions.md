# F09: realtime notifications and mentions (KP2, KP3)

## Scope

F09 informs a user, without a page reload, when they are mentioned in a channel or receive a direct message, and lets them jump to the conversation. It illustrates KP2, a realtime use case whose value is immediacy, and KP3, server push to one specific user rather than to a room.

## Choosing mentions

The server does not parse `@name` text. The client sends the identifiers of the mentioned users in `message:send.mentions`, and the server rejects the message if any of them is not a current member of the room. To make that rule usable, the client needs the room's membership, which the original API did not expose; `GET /api/rooms/{id}/members` was added for this purpose and is restricted to members.

Typing `@` in the composer opens a list of up to six members, matched on the start of any word of the display name with Vietnamese diacritics ignored and the author excluded. Arrow keys, Enter or Tab select a member and insert `@Display Name`. When the message is sent, only users whose `@Display Name` still appears in the text are included, so deleting an inserted name also removes the mention. Rendered messages highlight `@Display Name` tokens of room members, with a stronger highlight for the reader's own name; the content remains plain text.

## Delivery and presentation

Notifications are persisted by the server and pushed on the private queue `/user/queue/notifications` as `notification:new`; reading one emits `notification:read` to all of that user's sessions. The client keeps the first page from `GET /api/notifications` in the TanStack Query cache, prepends new notifications unless the identifier is already present, and decrements the unread count only when a notification changes from unread to read. Duplicate events from several tabs or from retried sends therefore cannot inflate the count, and reading in one tab clears the badge in the others. The snapshot is reloaded after every reconnect because the broker does not replay missed events.

A bell in the header shows the unread count and a panel with recent notifications. A toast appears for each new unread notification unless its room is the one currently open in a visible tab. Opening a notification marks it read and navigates to its room only if the reader still belongs to it; a newly created direct message that is not yet in the cached room list triggers a direct REST lookup first. System notifications from F12 have no room and are shown without a link.

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
