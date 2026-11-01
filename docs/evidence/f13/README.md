# F13 local verification evidence

The files in this directory are produced by an actual local run against the Docker application and MySQL, not by preset or fabricated chart data. Browser results describe one device and one run; they are not production capacity claims. See [the experimental method](../../features/protocol-lab.md) for metric definitions and exclusions.

Capture command (Windows PowerShell, from the repository root, with Docker healthy and Chrome installed):

```powershell
$env:PLAYWRIGHT_CHANNEL = 'chrome'
$env:LAB_EVIDENCE_DIR = (Join-Path (Get-Location) 'docs/evidence/f13')
try {
    npm.cmd --prefix client run test:e2e -- lab.e2e.ts
} finally {
    Remove-Item Env:PLAYWRIGHT_CHANNEL, Env:LAB_EVIDENCE_DIR
}
```

The E2E test creates its own ordinary employee account, runs the full default four-protocol workload, exports `browser-results.json`, and optionally captures `desktop.png` and `mobile.png`. Bearer tokens and raw authentication frames are never exported. Test-created accounts remain in the local database, following the repository's existing E2E convention. Browser capture is opt-in; default test runs retain no screenshots.

## Verified run: 28 October 2026

Docker production build, lint, **154 frontend tests**, and **33 backend integration tests** passed. The full browser E2E passed, including cancellation, same-account session isolation, native JSON WebSocket framing, direct-route reload, JSON export, and mobile layout. The independent CLI smoke completed all four transports; its counters and measurements are retained in [cli-results.json](cli-results.json).

Browser environment: Chrome headless on Windows, local HTTP at `http://localhost:8080`. Export timestamp: `2026-10-28T15:35:06.160Z` (UTC). Each protocol completed 20 samples with 128 text bytes, a 250 ms target send interval, a 100 ms short-poll interval, and a five-second planned sending window. No CLI benchmark was run concurrently with this final browser capture.

| Protocol | p50 (ms) | p95 (ms) | HTTP fetches | Header estimate (B) | WS Upgrade attempts | WS frame estimate (B) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| poll | 78.20 | 133.90 | 69 | 55731 | 0 | 0 |
| long-poll | 20.00 | 25.70 | 41 | 33594 | 0 | 0 |
| sse | 14.70 | 17.20 | 22 | 18390 | 0 | 0 |
| websocket | 7.90 | 10.30 | 0 | 0 | 1 | 240 |

HTTP fetch totals include baseline cursor and SSE opening requests. WebSocket's one Upgrade is separate; its header byte size is unavailable. Zero HTTP/header values for WebSocket do **not** mean zero network cost. Payload/body bytes, samples, setup time, observed sending-window duration, scheduling lag, and complete definitions are in [browser-results.json](browser-results.json). These are one-run observations and may differ on repetition.

- [Desktop result screenshot](desktop.png)
- [Mobile result screenshot](mobile.png)
- [Full browser export](browser-results.json)
- [Independent CLI export](cli-results.json)

Peer approval, issue closure, and report/video acceptance are not inferred from these automated checks. No commit or push is performed by the implementation workflow.
