# F10–F11: offline queue, retries, limits and safe rendering (KP4)

## Scope

F10 guarantees that messages written while the connection is unavailable are delivered later, in order and exactly once. F11 keeps clients within the server's limits and ensures that hostile content is displayed, never executed. Both concern KP4: correctness and security of persistent connections under failure and abuse.

## Ordered send queue

Every send goes through a single queue in the client (`outbox.ts`). The message appears immediately as a pending copy identified by a client-generated `clientMsgId`, and the queue sends one command at a time in the order the user pressed Send, across all rooms. The server persists a message once per sender and `clientMsgId` and returns the existing message when the same identifier arrives again, so a retry can never create a duplicate.

The queue reacts to each outcome as follows:

| Outcome | Handling |
| --- | --- |
| Acknowledged | Remove from the queue; replace the pending copy with the stored message |
| No connection, or the browser reports offline | Mark *Chờ kết nối để gửi…*; resume when STOMP reconnects or the browser reports online |
| Ack timeout (10 s) while still connected | Treated as a lost acknowledgement: resend after 1 s with the same `clientMsgId` and payload |
| `rate_limited` | Show *Bạn gửi quá nhanh … Sẽ tự gửi lại*, wait 5 s, resend with the same `clientMsgId`, keep the order |
| `forbidden`, `invalid_payload` | Remove from the queue, show the reason under the message with *Thử lại*, continue with the next message |

Detecting a dropped network through STOMP heartbeats takes about 20 seconds. The client therefore also listens to the browser's `offline` event, closes the socket immediately and switches the queue and the banner to the waiting state. Because the realtime client stops reconnecting after five consecutive failures, an `online` event creates a new connection. A banner in the open room states that the connection is lost and how many messages are waiting. The composer stays usable while offline as long as the room's history was loaded once, since the pending copy is inserted into that list. The queue lives in the tab's memory; messages not yet sent are lost if the page is reloaded.

## Limits and errors

The server accepts at most 10 sends per socket in any rolling five seconds and at most 2048 UTF-8 bytes of content. The composer counts bytes rather than characters and disables sending above the limit, which matters for emoji and Vietnamese text. A burst above the rate limit is not shown as an error: the queue waits and delivers the remaining messages. Negative acknowledgements and REST errors use the shared codes `unauthorized`, `rate_limited`, `invalid_payload` and `forbidden`, mapped to Vietnamese messages in one place.

## Safe rendering

All message content, notification text and file names are rendered as React text nodes; the client never uses `dangerouslySetInnerHTML`. Mention highlighting splits the text into plain strings and wraps matches in spans without interpreting markup. Attachments are fetched with the bearer token and shown through blob URLs, and the server serves downloads as attachments with `nosniff` and a sandbox content-security policy.

## Verification

Measured on 27 October 2026 with `client/e2e/collaboration.e2e.ts` against the Docker backend:

| Check | Observation |
| --- | --- |
| Offline queue | With the sender's browser offline, three messages showed the waiting state and the banner reported *3 tin đang chờ*; nothing reached the other user. After going online all three arrived in order, and after a reload the history held exactly those three messages once each |
| Rate limit | Twelve messages sent back to back showed the *quá nhanh* notice and all twelve reached the recipient in order with no failures |
| Hostile content | `<img src=x onerror=…><script>…</script>` was displayed literally; no image or script element was created and the flag set by the payload stayed undefined |
| Regression | F02 session, F03/F04 chat, F05 history and F06–F08 browser tests still passed |

Unit tests use fake timers to cover strict ordering, queuing while disconnected and flushing on reconnect, resending a lost acknowledgement with an identical payload, returning an in-flight message to the queue when the connection drops, the 5-second wait after `rate_limited`, and skipping a rejected message without blocking the queue. Duplicate prevention for retried identifiers is verified on the server by its integration tests. While testing, the composer was found to lock when a background history refetch failed offline, and the offline state was found to appear only after the heartbeat timeout; both were fixed as described above.

## Limitations

The queue is not persisted across reloads. Limits are enforced per server instance and reset when it restarts. Very large frames are rejected by the transport rather than by an application acknowledgement.
