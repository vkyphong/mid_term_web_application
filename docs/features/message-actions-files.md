# F14–F15: editing, deletion, reactions and file messages (KP1, KP3)

## Scope

F14 lets authors edit and delete their messages and lets members react to any message, with every change visible at once to everyone in the room. F15 adds images and PDF files to messages. Together they show KP3, broadcasting state changes rather than new messages, and KP1, the use of plain HTTP for large binary transfers alongside the WebSocket channel.

## F14: changes in place

Hovering or focusing a message reveals a toolbar. Every member can open a picker with the six reactions the server accepts; authors also see *Sửa* and *Xoá*. Editing replaces the bubble with a text area (Enter saves, Escape cancels, the 2048-byte limit applies), and deletion asks for confirmation. Each action is a STOMP command with an application acknowledgement. The acknowledgement and the event broadcast to the room both carry the updated message, and the client replaces the message with the same identifier, so a change never appears as an additional message, whichever arrives first.

Reactions are grouped by emoji with a count, and the reader's own reaction is highlighted. A click sends `active: false` for one's own reaction and `active: true` otherwise, so resending a command cannot toggle the state by accident. Edited messages show *(đã sửa)*. Deletion is soft: the server clears the content, reactions and file access, and every client shows *Tin nhắn đã bị xoá* in place, including after reloading the history. The toolbar is not offered on pending, failed or deleted messages, and the server still checks authorship and membership for every command.

## F15: files

The attach button accepts JPEG, PNG and PDF. The client rejects empty files, other types and files larger than 5 MiB before any upload, then uploads the file immediately to `POST /api/uploads` as multipart data. It uses `XMLHttpRequest` instead of `fetch` because only the former reports upload progress, and it retries once with a refreshed token on 401. While the upload runs, the composer shows the file name, size and a progress bar; once it finishes, the message can be sent with or without text and references the upload by `uploadId`. Retrying a send reuses its `clientMsgId` and `uploadId`, and the server binds an upload to a single message, so a reconnect cannot produce duplicate attachments.

Downloads require authentication and membership, so an `<img src>` pointing at the file cannot work: the browser would not attach the bearer token. Images are therefore fetched with the token, displayed through a blob URL that is revoked when no longer needed, and open in full size on click. PDFs and images both offer a download button that saves the file under its original name. Recipients receive file messages in real time through `message:new` like any other message.

## Verification

Measured on 27 October 2026 with `client/e2e/collaboration.e2e.ts` against the Docker backend:

| Check | Observation |
| --- | --- |
| Edit | The recipient saw the new text with *(đã sửa)*; the number of messages did not change |
| Permissions | A non-author had no edit or delete control on another user's message |
| Reactions | 👍 appeared as *👍 1* for the author and disappeared when the reacting user removed it |
| Delete | *Tin nhắn đã bị xoá* appeared for the recipient and remained after reloading the history; the original text was gone |
| Size limit | A file of 5 MiB + 1 byte was rejected with *vượt quá giới hạn 5 MB* and no upload request was sent |
| Image | A 32×16 PNG was displayed to the recipient in real time with its natural width of 32 px |
| PDF | A file-only message without text produced a download that saved `bao-cao.pdf` |
| Outsider | A user outside the room received 403 for the file URL |
| Stability | 9 of 9 repeated runs passed |

Component tests cover saving and cancelling an edit, delete confirmation, the absence of controls for non-authors, reaction grouping and the `active` flag, the deleted and edited states, and literal rendering of markup. Unit tests cover the client-side size and type checks, including the exact 5 MiB boundary.

## Limitations

The edit history is not kept; only the latest text and the edit time are shown. Uploads that are never sent remain on the server volume. The client trusts the server's file-signature checks and does not scan file contents.
