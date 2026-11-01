# Protocol Lab (F13 / KP1)

## Purpose and experimental boundary

The Protocol Lab is an authenticated browser experiment comparing short polling, long polling, Server-Sent Events (SSE), and native WebSocket. It is separate from business chat and uses no STOMP frames. The browser page is available at `/lab`; both ordinary employees and administrators may access it. The existing backend remains a single Spring Boot instance. No Redis, Nginx, new database schema, or multi-instance routing is introduced.

KP1 is demonstrated by observing how transport mechanisms affect application-visible delivery latency and request overhead under a controlled workload. The experiment is not a saturation test, production capacity claim, or measurement of total network traffic. Results depend on the browser, operating system, network, server load, and configuration captured for that run.

## Controlled workload

The default workload contains 20 messages, an inter-send interval of 250 ms, a text payload of 128 ASCII `x` bytes, and a short-poll interval of 100 ms. The planned sending window is therefore 5 seconds per protocol. All four trials execute sequentially using the same immutable configuration snapshot. A single-protocol run is also supported. Editing controls after a run does not change the configuration recorded with its results.

The browser schedules send `i` against the absolute monotonic offset `t0 + i × intervalMs`. Sending does not await the preceding pong. The browser records the actual send offset and scheduling lag for every sample. A trial fails if scheduling falls behind by an entire send interval, preventing a catch-up burst from silently changing the workload. Hiding the document, leaving the page, logging out, or pressing Stop aborts outstanding requests and closes experimental resources. Where the Web Locks API is available, an origin-wide lock prevents two Lab pages in the same browser from running simultaneously. On browsers without Web Locks, users must avoid concurrent experiments in other tabs.

Configuration permits 5–100 messages, 100–1000 ms send intervals, 0–1024 text bytes, and 50–1000 ms short-poll intervals. The planned sending window is capped at 45 seconds to stay below the backend SSE stream lifetime. A final delivery may arrive after the planned sending window; the export separately records planned configuration, observed sending-window duration, transport setup duration, and total trial duration including delivery and cleanup. Browser timer precision and scheduling jitter prevent a promise of perfectly identical wall-clock durations.

The payload-byte setting describes the text field, not the complete JSON envelope. Every ping has `{type,payload,ts,correlationId}`. Its unique ID is 41 ASCII characters, including a fixed-width message index, so ID length does not vary by protocol or message position. The server returns an application-level `lab:pong` with the same payload and correlation ID, plus server timestamp and sequence. The server accepts legacy pings without `correlationId`; when provided, it validates and echoes the field. The browser requires it for measured samples. This is an application acknowledgment, independent of HTTP success or any STOMP receipt.

## Delivery paths and latency definition

| Protocol | Submission | Measured delivery |
| --- | --- | --- |
| Short polling | `POST /api/lab/ping` | A continuous series of immediate `GET /api/lab/poll?after=...` requests, scheduled at the configured poll interval |
| Long polling | `POST /api/lab/ping` | One outstanding `GET /api/lab/long-poll?after=...`, renewed after each response or server timeout |
| SSE | `POST /api/lab/ping` | A named `lab:pong` event read from authenticated streaming `fetch('/api/lab/sse?...')` |
| Native WebSocket | JSON `lab:ping` on `/lab/ws` | JSON `lab:pong` on that same socket |

HTTP submission responses deliberately do not complete latency samples. This prevents an HTTP POST response from masquerading as an SSE, polling, or long-poll delivery. Each sample starts immediately before submission and ends when the selected delivery path supplies the matching ID, correlation ID, and text. All durations use `performance.now()` in the same browser. Server wall-clock timestamps are metadata and are never subtracted from client timestamps, avoiding clock synchronization assumptions.

Transport establishment, authentication, cursor initialization, and WebSocket `lab:ready` are outside the latency interval. The browser reads the current history cursor before HTTP-based trials and ignores older events. It rejects an unexpected history gap and never counts duplicate or unrelated IDs. Failed, cancelled, and incomplete trials remain visible with their actual sample counts; only complete trials appear in comparison charts. p50 and p95 use the nearest-rank definition on a sorted copy of the latency samples.

## Request, header, body, and frame accounting

`httpRequests` counts every attempted Lab `fetch`, including the baseline cursor request and the SSE opening request. `setupHttpRequests` identifies those setup requests as a subset of the total. `httpResponses` counts response headers actually received; aborted or failed attempts can make these counts differ. Authentication, application navigation, normal chat traffic, and the WebSocket upgrade are excluded from this counter. The latter is reported separately as one attempted HTTP Upgrade for a native-WebSocket trial. Handshake byte size is unavailable through the browser WebSocket API and is not fabricated.

HTTP header byte values are explicit **estimates**, using a textual HTTP/1.1 model:

1. The request line, synthetic Host header, headers explicitly set by the Lab (`Authorization`, `Accept`, and Content-Type when applicable), synthetic Content-Length for a request body, CRLF delimiters, and terminating blank line.
2. A synthetic HTTP/1.1 response status line and response header names/values exposed to JavaScript through Fetch.

The browser manages additional request headers, normalizes response headers, and hides some response headers. Therefore, these estimates are neither packet captures nor exact wire-byte measurements. In particular, browser-managed headers, HPACK/QPACK, actual connection reuse, and the selected network HTTP version are not measured. Measured Lab fetches omit cookies and disable caching. The export contains only byte counts, not token values or raw authentication frames. See the [Fetch Standard](https://fetch.spec.whatwg.org/#headers-class) and [MDN's forbidden request headers](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header) for the browser API boundaries.

HTTP request and response bodies are counted separately from headers. These body counters include protocol wrappers, empty poll pages, POST response bodies, and SSE event framing as received by Fetch. They must not be interpreted as only the configured text payload. Native-WebSocket JSON message payload bytes are counted separately in each direction.

WebSocket data-frame overhead is estimated under the explicit assumption of one uncompressed, unfragmented text frame per ping or pong. It includes the two-byte base header, extended payload length where required, and the four-byte client masking key. Server frames are unmasked. Authentication, ping/pong control frames, Close frames, negotiated compression, and fragmentation are outside the estimate. The model follows [RFC 6455, section 5.2](https://www.rfc-editor.org/rfc/rfc6455#section-5.2). TLS, TCP/IP, HTTP chunk framing, and network compression are excluded from all headline overhead figures.

## Session isolation and error handling

Lab histories belong to an authentication session, not merely an account ID. A different login for the same account begins with a separate history. Histories are capped at 256 events. Long polling and SSE retain the backend's bounded connection counts, 25-second long-poll timeout, and 60-second stream lifetime. The experiment stays below the 20-ping/second/session limit. Tokens are provided as Bearer headers for HTTP or in the initial raw-WebSocket authentication frame, never as URL parameters.

The measured transport does not retry automatically: retries would alter request counts and timing. The page may refresh authentication before the experiment, outside measured traffic. Expiry, revocation, malformed responses, mismatched payloads, connection loss, rate rejection, and server history reset invalidate the trial. Existing API errors retain their `unauthorized`, `forbidden`, `invalid_payload`, and `rate_limited` codes. The experiment does not send chat messages or persist experimental pongs in MySQL.

## Reproduction and evidence

Start the project with Docker Compose, log in, open `/lab`, keep the tab foregrounded, and choose **Chạy cả 4 giao thức**. Download JSON after completion. The export records the environment, measurement definitions, immutable configuration, counters, timing summaries, and chronological samples. Run the same preset again to study variability; a single run must not be presented as a universal ranking.

`scripts/smoke-lab.mjs` remains an independent Node HTTP smoke benchmark with its documented sequential stop-and-wait loop. It uses the same default message count, text size, and target pacing, but its request schedule, header visibility, and accounting scope differ from the browser harness. Compare protocols within a single harness and configuration; do not merge CLI and browser results into one latency distribution.

Unit tests cover workload limits, nearest-rank percentiles, UTF-8/header/frame accounting, incremental SSE framing, identical scheduled submissions on all four transports, payload validation, and cancellation. Backend integration tests cover correlated pongs and session-scoped history. Browser E2E uses the complete default workload on real endpoints, checks native JSON WebSocket frames, a separate same-account login's isolation, JSON export, cancellation, direct-route reload, and a 390px viewport. Optional evidence capture is enabled only by an explicit `LAB_EVIDENCE_DIR` environment variable.

Local evidence is recorded in [the F13 evidence directory](../evidence/f13/README.md). Peer review, issue acceptance, and the report/video presentation remain human review activities; completing implementation does not automatically close the issue or create/push a commit.
