# Collaboration — F06–F12 and F14–F15

Uses the [shared API conventions](README.md), [STOMP transport](realtime.md) and canonical [Message model](chat.md#models). History pagination and retry behavior are defined in [chat](chat.md).

Receipt counts use a snapshot of room members other than the sender when a message is created. Joining later does not add a recipient; leaving does not remove historical receipts. Access still requires current membership.

## F06 presence

`GET /api/presence` → `{users:[{userId,online,lastSeen}]}`. Subscribe `/user/queue/presence` for `presence:update` with the same user shape. Presence is visible to authenticated company users. A user is online while at least one authenticated chat socket exists. Closing one of several tabs does not change this. Closing the last updates persistent `lastSeen`; token expiry/logout/kick/ban also close sockets. After server restart everyone starts offline; `lastSeen` is the last observed disconnect, not an inferred crash timestamp. Reload the snapshot after reconnect. Lab sockets do not count as chat presence.

## F07 typing

| SEND destination | Type | Payload |
| --- | --- | --- |
| `/app/typing.start` | `typing:start` | `{roomId}` |
| `/app/typing.stop` | `typing:stop` | `{roomId}` |

Members subscribe `/user/queue/typing`. Events use the matching type and `{roomId,userId,typing,ttlMs:3000}`. Server derives user identity and checks membership. No typing state is persisted. FE throttles start updates and removes indicators after three seconds without updates, on stop, or when leaving. Server permits five typing commands/second/socket; all collaboration actions additionally share a 30/5-second window.

## F08 receipts

SEND `/app/message.delivered` or `/app/message.seen`, types `message:delivered` / `message:seen`, payload `{messageId}`. Only the authenticated original recipient can update their receipt. `seen` implies delivered; duplicate/older updates never move backwards. The sender cannot acknowledge on another user's behalf.

Ack data and `/user/queue/events` events contain the updated Message. `GET /api/messages/{id}/receipts` → `[{userId,deliveredAt,seenAt}]`, restricted to current room members. DM shows sent after save, delivered when its recipient acknowledged, seen when they acknowledged seeing it. For channels show delivered/seen counts out of `recipients`; do not claim everybody read a message from just one receipt. FE sends seen only when its tab/conversation/message is actually visible; the server cannot observe browser visibility.

## F09 notifications and mentions

`message:send.payload` accepts optional `mentions: string[]` (at most 20 distinct member IDs). It also accepts optional `uploadId`. For the full send envelope, see [chat](chat.md#stomp-commands).


The server validates membership, creates mention notifications for those users and DM notifications for the other participant. It does not parse arbitrary `@displayName` text. Self-mentions do not create notifications; DM takes precedence over mention. Retry does not duplicate notifications. Notifications persist even when recipients are offline.

| REST | Response |
| --- | --- |
| `GET /api/notifications?limit=30&before=<notificationId>` | `{notifications,nextCursor,unreadCount}`, newest first, limit 1–100 |
| `POST /api/notifications/{id}/read` | 200, empty body; idempotent |

Notification: `{id,type:"mention"|"dm"|"system",roomId?,messageId?,content,createdAt,readAt?}`. Subscribe `/user/queue/notifications` for `notification:new` (Notification) and `notification:read` (`{id}`). Reading is synchronized to all of that user's tabs. Listing/counting hides notifications for rooms the requester no longer belongs to. Follow links only after validating current room access.

## F11 limits

Message content is at most **2048 UTF-8 bytes**, not characters. Content must be nonblank unless attaching a file. A socket may attempt at most 10 sends in any rolling five seconds, including retries/invalid send attempts after envelope validation. On `rate_limited/send_limit`, wait five seconds before retry; do not create a new `clientMsgId`. STOMP frames are capped at 8 KiB and send buffers at 32 KiB. Oversized frames may cause a transport close instead of an application ack. Limits are per single server and reset on reconnect/server restart; this is the specified session limit, not a cluster-wide abuse prevention service.

## F12 administration

Only enabled accounts with database role `admin` can access admin APIs, commands or `/user/queue/admin`. Registration always creates ordinary users. See [operations](../operations.md#mysql-workbench) for account-role setup. Backend authorization reads the current database role.

| REST | Body / response |
| --- | --- |
| `GET /api/admin/stats` | `{connections,onlineUsers,msgPerSec,activeRooms}` |
| `GET /api/admin/users?search=&page=0` | `{users:[{id,email,displayName,role,enabled,online}],total,page,pageSize:20}`; includes banned accounts; literal case-insensitive name/email substring, search ≤254 characters, page 0–100000 |
| `GET /api/admin/channels` | `{channels:[{id,name,members,messagesLastMinute,lastMessageAt}]}`; latest 50 public channels with messages in the last 60 seconds, excluding DMs |
| `POST /api/admin/users/{id}/kick` | Empty body → 200 |
| `POST /api/admin/users/{id}/ban` | Empty body → 200 |
| `POST /api/admin/broadcast` | `{content}` → `{recipients}` |

STOMP equivalents: `/app/admin.kick`, type `admin:kick`, `{userId}`; `/app/admin.broadcast`, type `admin:broadcast`, `{content}`. Both use normal command acks. Every second `admin:stats` is pushed on the admin queue. Connections means authenticated chat sockets; onlineUsers counts distinct chat users; msgPerSec counts new persisted messages in the previous second; activeRooms counts rooms with a new message in the previous 60 seconds. Stats cover one instance and exclude Lab traffic.

Kick closes all current chat and raw Lab sockets but permits future login/reconnect. Ban disables the account, revokes all its auth sessions and closes those sockets; pending Lab HTTP streams/requests are rejected/closed on their next periodic authorization check (within approximately one second). Self-ban is rejected. Broadcast stores a `system` notification for every enabled user, including offline users, and pushes it to connected notification subscribers. Content limit is 2048 UTF-8 bytes.

## F14 edits, deletion and reactions

| SEND | Type | Payload |
| --- | --- | --- |
| `/app/message.edit` | `message:edit` | `{messageId,content}` |
| `/app/message.delete` | `message:delete` | `{messageId}` |
| `/app/message.react` | `message:react` | `{messageId,emoji,active:boolean}` |

Only the author can edit/delete, and they must still belong to the room. Delete is soft and idempotent. Deleted messages cannot be edited/reacted to; reactions are cleared. Any current member can add/remove their own reaction; `active:true` adds, false removes, so retries never toggle accidentally. Allowed emoji: 👍 ❤️ 😂 😮 😢 🎉. Ack and event payloads are the updated Message; event type matches the operation on `/user/queue/events`. FE replaces by ID rather than appending. Concurrent writes serialize on the room lock.

## F15 files

`POST /api/uploads`, authenticated `multipart/form-data` with `roomId` and `file`, returns 201 `{id,roomId,filename,mediaType,size,url}`. One file per message, 1–5,242,880 bytes (5 MiB). JPEG, PNG and PDF signatures are accepted; image dimensions/decodability are checked (max 25 megapixels). MIME supplied by the client is not trusted. PDF signature checking is not full PDF validation or malware scanning. Files are stored under random IDs in the Docker `uploads-data` volume; original names are metadata, not filesystem paths.

Send `message:send` with `uploadId`, same room, and a new `clientMsgId`; `content:""` is allowed for file-only messages. Only the uploader can attach an unused upload; attaching the same upload to another message fails. Retry with the original clientMsgId returns the original message. Before attachment only the owner can download; afterward any current room member can use authenticated `GET /api/uploads/{id}`. Outsiders are denied, even if they know the URL. Deleted-message files are denied. Downloads use `Content-Disposition: attachment`.

FE must fetch the file with its Bearer header and create a blob URL for an image preview or download; a plain `<img src>` cannot attach that header. Revoke blob URLs when no longer used. Upload progress is a client concern (e.g. XMLHttpRequest). Unsent uploads currently remain on disk; volume capacity/backup are operator responsibilities. Removing containers preserves uploads; deleting volumes does not. Back up MySQL and uploads together.

## Related contracts

See [frontend integration order](README.md#frontend-integration-order) and the separate [Protocol Lab contract](lab.md). UI behavior, browser rendering security, offline queue UX, peer review and report/video remain team acceptance work.
