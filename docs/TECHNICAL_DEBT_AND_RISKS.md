# Technical Debt And Risks

## Critical Risks

### 1. Runtime Ownership Is Split

Files involved:
- `server.js`
- `services/streamManager.js`

Risk:
- the panel live runtime is really owned by `server.js`
- a second stream manager exists and is also used by some routes and tests
- this creates ambiguity about which lifecycle path is authoritative

### 2. Distributed Runtime Surface Overstates Reality

Files involved:
- `services/serverService.js`
- `routes/stream.js`
- `agent/index.js`
- `routes/admin.js`

Risk:
- selectors, failover, proxy relationships, command tables, and server pages exist
- full remote live orchestration does not
- the product can look more distributed than it really is

### 3. Security Hardening Is Behind The UI Surface

Files involved:
- `server.js`
- `middleware/securityHeaders.js`
- `middleware/rateLimiter.js`
- `routes/admin.js`
- `services/securityService.js`

Risk:
- no CSRF protection
- CORS reflects origin with credentials
- `streamLimiter` is defined but not mounted
- CSP is disabled
- HSTS is off by default
- secrets remain in plaintext in multiple places

### 4. Database Evolution Is Ad Hoc

Files involved:
- `scripts/schema.sql`
- `lib/db.js`
- `scripts/add-db-indexes.sql`

Risk:
- schema changes are split between SQL files and runtime `ensure*()` functions
- drift is already visible
- production upgrades become harder to reason about

### 5. Operational Dashboards Are Only Partially Truthful

Files involved:
- `services/wsServer.js`
- `services/healthMonitor.js`
- `routes/admin.js`
- `routes/playback.js`

Risk:
- remote metrics are heartbeat-driven and partially real
- local viewer counters are not properly fed into `channel.viewers`
- health monitor calls an admin route that is protected by admin auth, without credentials
- some cards display placeholders like `0` or `—` rather than measured values

## High Risks

### Redis Boot Handling Is Weak

`server.js` always logs Redis as connected after `redis.connect()`, even though the helper returns `false` on failure.

Impact:
- startup logs can overstate health
- features that rely on Redis may degrade silently

### Backup Settings And Backup Reality Diverge

Files involved:
- `services/backupService.js`
- `lib/crons.js`
- `lib/db.js`

Impact:
- backups really work locally
- cloud uploads do not
- cron backup cadence does not clearly honor all settings surfaced in the panel

### Multi-Login Detection Is Mostly A UI Surface

Files involved:
- `services/multiLoginDetector.js`
- `routes/admin.js`

Impact:
- it is in-memory
- recording hooks are not broadly wired into actual playback flows
- it looks stronger than it is

### VPN / ASN Enforcement Is Partial

Files involved:
- `routes/admin.js`
- `services/vpnDetector.js`
- `services/asnBlocker.js`

Impact:
- support code exists
- a `buildVpnasnMiddleware()` helper exists but is not mounted
- actual enforcement is incomplete

### API Playback Uses A Separate, Fragile Session Model

Files involved:
- `routes/playback.js`
- `services/sessionService.js`
- `services/userService.js`

Impact:
- API playback uses in-memory tokens
- user meta is stored in `data/user_meta.json`
- this path is not cluster-safe and differs from line/Xtream playback

## Medium Risks

### Frontend Global Coupling

Files involved:
- `public/js/app.js`
- `public/index.html`
- `public/js/reseller-app.js`

Impact:
- any missing `APP` or `RSL` export breaks UI controls
- route/page alias drift is easy to introduce

### Provider Import Jobs Are Memory-Resident

File:
- `services/importService.js`

Impact:
- job state is not persistent across restarts
- larger imports are operationally fragile

## Fake Security Vs Real Security

Real security controls:
- signed playback URLs
- line password hashing
- access-code portal gating
- API key hashing

Weak or cosmetic controls:
- RBAC without strong enforcement
- stream rate limiting that is never mounted
- VPN/ASN enforcement helpers not wired globally
- dashboard security pages that exceed actual enforcement depth

## Top 10 Riskiest Files

| File | Risk Reason |
| --- | --- |
| `server.js` | central runtime, auth gateway, and boot control |
| `routes/admin.js` | oversized admin control plane |
| `lib/db.js` | giant DAO plus migrations and defaults |
| `public/js/app.js` | main admin frontend monolith |
| `public/index.html` | giant inline-handler shell |
| `services/serverService.js` | selector, failover, and proxy correctness |
| `routes/stream.js` | subscriber-facing playback auth and redirects |
| `lib/ffmpeg-args.js` | ingest/output behavior matrix |
| `services/importService.js` | import breadth and side effects |
| `services/provisionService.js` | remote SSH and agent deployment |

## Debt Summary

The codebase does not primarily suffer from a lack of features.

It suffers from a mismatch between:
- feature breadth
- architectural clarity
- runtime truth
- operational honesty

That is the debt that matters most.
