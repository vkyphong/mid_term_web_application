# Authentication — F01

Uses the [shared API conventions](README.md). Defaults: allowed email domain `DQGM.dev`, access lifetime 900 seconds, fixed refresh-session lifetime seven days.

## Endpoints

| Endpoint | Authentication / body | Success |
| --- | --- | --- |
| `POST /api/auth/register` | `{email,displayName,password}` | 201 `AuthResponse`, set refresh cookie |
| `POST /api/auth/login` | `{email,password}` | 200 `AuthResponse`, set refresh cookie |
| `POST /api/auth/refresh` | Refresh cookie, no body | 200 `AuthResponse`, rotate refresh cookie |
| `POST /api/auth/logout` | Refresh cookie, no body | 204, revoke session and clear cookie |
| `GET /api/auth/me` | Bearer access token | 200 user object |

```ts
interface User {
  id: string
  email: string
  displayName: string
  role: 'user' | 'admin'
}

interface AuthResponse {
  accessToken: string
  expiresIn: number // seconds; default 900, configurable
  user: User
}
```

Registration example:

```json
{
  "email": "employee@DQGM.dev",
  "displayName": "Employee",
  "password": "DemoPassword123"
}
```

## Validation

| Field | Rule |
| --- | --- |
| `email` | Valid email, maximum 254 characters, exactly one `@`, allowed domain |
| `displayName` | 2–50 characters after trimming |
| `password` | At least eight characters, one ASCII letter and one digit, at most 72 UTF-8 bytes |

Email is trimmed and lowercased. The server compares the domain exactly against `ALLOWED_EMAIL_DOMAINS`: `a@DQGM.dev` is allowed by default; `a@evilDQGM.dev`, `a@DQGM.dev.evil.com` and `a@sub.DQGM.dev` are rejected. Frontend validation provides early feedback; backend validation is authoritative.

## Tokens and sessions

Keep access tokens in frontend memory. Send them in the REST Authorization header and STOMP CONNECT header. JWTs use HS256, issuer `pulsechat`, user ID as subject and auth-session ID as `sid`. The JWT secret comes from environment configuration and must contain at least 32 characters.

Refresh tokens are random opaque 256-bit values. Only their SHA-256 hashes are stored. The backend issues an HttpOnly cookie:

```text
Set-Cookie: refreshToken=<opaque>; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=604800
```

`Secure` is also set when `COOKIE_SECURE=true`. HTTP local/LAN defaults to false. Use `credentials: 'include'` when calling cookie-authenticated endpoints.

Rotation locks the stored session so only one concurrent refresh succeeds. An old refresh value returns 401 without invalidating the newly rotated session. Rotation preserves the original seven-day deadline; the new cookie's Max-Age is its remaining lifetime.

Logout revokes the session, clears its cookie and closes that session's chat sockets. Access JWTs from the same session also stop working; independent logins remain valid. Retired refresh hashes permit logout with a pre-rotation cookie during an in-flight refresh, but cannot be used to refresh again.

An enabled account and active session are checked on authenticated requests. Ban disables the account and revokes all sessions; subsequent calls may report `invalid_token` or `refresh_invalid` because revocation is checked before account enablement.

## Errors

| Situation | HTTP | Code | Reason |
| --- | --- | --- | --- |
| Invalid input | 400 | `invalid_payload` | `validation`, with field details |
| Disallowed domain | 403 | `forbidden` | `domain_not_allowed` |
| Existing email | 409 | `invalid_payload` | `email_taken` |
| Incorrect email/password | 401 | `unauthorized` | `invalid_credentials` |
| Missing, expired, reused or revoked refresh token | 401 | `unauthorized` | `refresh_invalid` |
| Invalid, expired or revoked access token | 401 | `unauthorized` | `invalid_token` |
| Disabled account, when reached before session revocation | 403 | `forbidden` | `banned` |
| Rejected Origin | 403 | `forbidden` | `origin_not_allowed` |

Wrong email and wrong password share `invalid_credentials`. F11's message-send limit does not rate-limit these auth endpoints, and they do not provide a `retryAfter` field.

## Frontend lifecycle and Origin

Restore the session through refresh on page load. The current client refreshes ahead of access expiry (at most 60 seconds early), retries an unauthorized REST request once, and reconnects STOMP with the replacement token. Network refresh failures preserve the local session and retry after five seconds; 401/403 ends it. See [realtime](realtime.md) for connection limits and reconnect behavior.

Cookie-authenticated POSTs use SameSite Strict cookies and an Origin guard. Same-origin requests and exact configured `ALLOWED_ORIGINS` are accepted; other browser origins are rejected. Non-browser clients may omit Origin. The [Vite proxy](../../client/README.md) keeps local frontend requests on one browser origin.
