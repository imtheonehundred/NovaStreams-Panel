# Security Model

> Last updated: 2026-04-08 (post P1–P4 implementation)

## Overview

novastreams-panel implements multiple security layers: access-code gateway, role-based sessions with fixation protection, per-session CSRF, rate limiting, HMAC-signed stream URLs, bcrypt/AES-256-GCM cryptography, Content Security Policy, HSTS, queryable audit log, and a full suite of subscriber enforcement services.

---

## Authentication Model

### Three-Layer Access Control

```
Layer 1 — Access Code Gateway
  /:accessCode → validates code in DB (Redis 60s cache)
  → Sets session: {accessCodeId, portalRole, accessCode}
  Without this step, no login form is served

Layer 2 — Session Authentication
  POST /api/auth/login → bcrypt verify → role match
  → req.session.regenerate() — issues NEW session ID (prevents fixation)
  → session.userId set
  Without this, only the SPA shell is served

Layer 3 — Role Authorization
  requireAdminAuth → requireAuth + isAdmin(userId) DB check (wrapped in try/catch)
  reseller routes check portalRole === 'reseller'
  client routes check portalRole === 'client'
```

### Session Security
- **Storage:** Server-side in Redis via `express-session` + `connect-redis`
- **Session fixation:** Prevented — `req.session.regenerate()` called on every login and registration
- `httpOnly: true` — not accessible to JavaScript
- `sameSite: lax` — CSRF protection at cookie level
- `secure: true` in production — HTTPS only
- Cookie name: `nsp.sid`
- TTL: 7 days

### Password Security
- User passwords: bcrypt cost 12 (`lib/crypto.js`)
- Line (subscriber) passwords: bcrypt for verification + AES-256-GCM encrypted for retrievable admin display
- API keys: `wm_<48 hex>` format, bcrypt-hashed, 12-char prefix for DB lookup performance

---

## CSRF Protection

- Library: `csrf` npm package
- Strategy: per-session secret stored in session; token derived from secret
- Token delivery: `GET /api/auth/csrf-token` → `{ csrfToken }` (requires gateway session)
- Token usage: `X-CSRF-Token` request header OR `_csrf`/`csrfToken` body field
- Applied to: all state-changing admin, auth, and reseller routes
- Skipped for: GET/HEAD/OPTIONS and `NODE_ENV=test`

---

## Content Security Policy

Configured in `middleware/securityHeaders.js` via Helmet:

```js
contentSecurityPolicy: {
  directives: {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'"],
    styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    imgSrc:         ["'self'", "data:", "https:"],
    connectSrc:     ["'self'", "ws:", "wss:"],
    fontSrc:        ["'self'", "https://fonts.gstatic.com"],
    objectSrc:      ["'none'"],
    frameAncestors: ["'none'"],
  }
}
```

All inline `onclick`, `onchange`, `onsubmit` handlers removed from SPA shells. Event handling delegated via `core/ui-common.js`.

---

## Security Headers

| Header | Status | Notes |
|---|---|---|
| `Content-Security-Policy` | **Enabled** | scriptSrc 'self', no unsafe-inline |
| `Strict-Transport-Security` | Auto in production | maxAge 1 year, includeSubDomains |
| `X-Frame-Options` | Enabled (DENY) | Clickjacking |
| `X-Content-Type-Options` | Enabled (nosniff) | MIME sniffing |
| `X-XSS-Protection` | Enabled | Legacy browsers |
| `Referrer-Policy` | Enabled | Privacy |
| `Permissions-Policy` | Enabled | Feature restriction |

---

## Rate Limiting

Four Redis-backed limiters:

| Limiter | Target | Limit | Key |
|---|---|---|---|
| `authLimiter` | login, register | 10 req / 5 min | IP + username |
| `adminLimiter` | All `/api/*` | 200 req / min | userId OR IP (unauthenticated) |
| `streamLimiter` | Stream routes | Configurable | IP |
| `apiKeyLimiter` | API key endpoints | 100 req / min | Key prefix |

Unauthenticated requests are rate-limited by IP (not skipped). Localhost bypass only with `ALLOW_LOCAL_NO_RATELIMIT=1`.

---

## Stream URL Security

```
URL: /live/{channelId}/{token}/{filename}
Token: HMAC-SHA256(channelId + userId + expiry, STREAM_SECRET)
TTL: 30–60s (nginx) / 3600s (node mode)
```

`STREAM_SECRET` required — server hard-fails at startup if missing.

---

## Subscriber Line Enforcement

Every Xtream stream request goes through `services/lineService.js`:

| Check | Service |
|---|---|
| bcrypt password verify | lineService |
| IP allowlist | lineService |
| UA allowlist | lineService |
| Connection limit | lineService + lines_activity |
| Expiry date | lineService |
| Geo restriction | geoip-lite |
| ASN/ISP blocking | asnBlocker.js |
| VPN detection | vpnDetector.js |
| Multi-login detection | multiLoginDetector.js |
| Sharing detection | sharingDetector.js |

---

## Encryption

All crypto centralized in `lib/crypto.js`.

| Operation | Algorithm |
|---|---|
| User/API key passwords | bcrypt cost 12 |
| Line password encrypt/decrypt | AES-256-GCM, 12-byte IV |
| Stream token | HMAC-SHA256 |

Output format: `v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`

`LINE_PASSWORD_SECRET` required — server hard-fails at startup if missing.

---

## Audit Log

Security and admin events written to `audit_log` table (added P3.4):

```
auditService.log(userId, action, resourceType, resourceId, meta, req)
```

Wired to: login, logout, line CRUD, channel CRUD, settings updates.
NODE_ENV=test short-circuits logging.

---

## Access Code Cache

Per-request memoization + Redis 60s TTL keyed `panel:access-code:<id>`. Negative caching via `{__missing:true}`. Eliminates N+1 DB calls on authenticated requests.

---

## Outstanding Issues

| # | Issue | File | Status |
|---|---|---|---|
| F1 | `docker-compose.yml` placeholder secrets (`change_me_*`) must be replaced | `docker-compose.yml` | 🔴 |
| F2 | Login 500 handler leaks `e.message` to client | `routes/auth.js:164` | 🔴 |
| F3 | `listLines` SQL returns `password_hash`/`password_enc` — exclude at query level | `repositories/lineRepository.js` | 🔴 |
| F4 | Verify all CRUD call-sites are wired to `auditService.log` | `services/auditService.js` | 🔴 |
| F9 | Logout `auditService.log()` missing `.catch(() => {})` | `routes/auth.js:171` | 🔴 |

---

## Security Practices

### Adding new routes
- Apply `requireAuth` or `requireAdminAuth`
- Apply `csrfProtection` to POST/PUT/DELETE
- Validate with Joi before processing
- Call `auditService.log()` on state changes
- Never expose `e.message` in production responses

### Secrets management
- All secrets in `.env` — never hardcoded, never committed
- Rotate with `openssl rand -hex 32`
- Never use `change_me_*` values in any real environment
