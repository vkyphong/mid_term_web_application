# F19 verification evidence

This directory contains optional artifacts from the real-browser test against the local Docker application and MySQL. The test uses three dedicated ordinary employee accounts and isolated rooms. It does not change existing users' boards or chat messages.

To reproduce from the repository root with Docker healthy and Chrome installed:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:WHITEBOARD_EVIDENCE_DIR = (Join-Path (Get-Location) 'docs/evidence/f19')
try {
    npm.cmd --prefix client run test:e2e -- whiteboard.e2e.ts
} finally {
    Remove-Item Env:PLAYWRIGHT_CHANNEL, Env:WHITEBOARD_EVIDENCE_DIR
}
```

The opt-in artifacts are `desktop.png`, `mobile.png`, and `verification.json`. The JSON contains accepted segment data, generation/revision, Canvas pixel checks, and the tested scenarios. No Bearer token, refresh cookie, password or raw authentication frame is saved. Test-created data remains in MySQL following the repository's existing E2E convention. Normal test runs without the environment variable do not save screenshots.

## Verified local run — 28 October 2026

The production Docker build and lint passed, with **166 frontend tests** and **39 backend integration tests**. F19 contributes 12 model/session tests and 6 backend integration tests. The real-browser F19 scenario passed in Chrome with three independent employee contexts on the running Docker/MySQL application.

| Check | Observed result |
| --- | --- |
| Simultaneous authors | Both members' independent segments appear in server revision order |
| Populated board before Clear | 14 persisted segments, generation 0, revision 14 |
| Outsider read/send | HTTP 403 and STOMP `forbidden` |
| Outsider events | 0 events from the tested room |
| Chat during drawing | Message sent and displayed through the normal chat path |
| Reload/reconnect | Persisted snapshot and current rendering recover |
| Leave/rejoin | No newly accepted events while outside; current snapshot available after rejoin |
| Mobile | 390px viewport, no horizontal overflow, real touch tap persisted |
| Confirmed Clear | Empty board, generation advances to 1; subsequent drawing contains only generation-1 segments |
| Drawing after Clear | 2 new persisted segments |
| Browser runtime errors | 0 |

The screenshots show the populated board before Clear; [verification.json](verification.json) contains that snapshot and the post-clear snapshot. The Canvas comparison checks matching server revision and spatial premultiplied RGBA tile sums with a small tolerance for rendering edges. Raw hashes are references, not a claim of identical pixels on every device.

- [Desktop screenshot](desktop.png)
- [Mobile screenshot](mobile.png)
- [Verification record](verification.json)

The [English design](../../features/whiteboard.md) and [event contract](../../api/whiteboard.md) define persistence, retry semantics, packet/rate/storage bounds, and the limits of the acceptance claims. Peer review, report/video presentation, and issue closure remain separate human activities.
