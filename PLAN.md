# PLAN.md — novastreams-panel Fix & Improvement Plan

> **Last Updated:** 2026-04-08
> **Status Key:** 🔴 Not Started | 🟡 In Progress | ✅ Done

---

## Overview

This document is the single source of truth for all fixes, improvements, and features planned for novastreams-panel. Items are organized by priority and sprint. Work on Critical items before anything else.

---

## Priority 1 — CRITICAL (Fix Before ANY Production Deployment)

These items will cause **crashes, data loss, or security breaches** in production if not addressed.

---

### [P1.1] Rotate All Committed Secrets ✅

**Problem:** `.env` is committed to the repository with real, weak credentials.

```
SESSION_SECRET=super_secret_iptv_123   ← compromised
DB_PASSWORD=123456                      ← trivially guessable
ALLOW_LOCAL_UNSIGNED_TS=1              ← must not be in prod
```

**Fix Steps:**

1. Add `.env` to `.gitignore` immediately:
   ```bash
   echo ".env" >> .gitignore
   git rm --cached .env
   git commit -m "remove .env from tracking"
   ```
2. Generate new secrets:
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   # Run 4 times — use outputs for:
   # SESSION_SECRET, LINE_PASSWORD_SECRET, STREAM_SECRET, DB_PASSWORD
   ```
3. Update MariaDB password and `.env` with new value
4. Restart all services

**Files:** `.env`, `.gitignore`

---

### [P1.2] Set Missing Required Env Vars ✅

**Problem:** `LINE_PASSWORD_SECRET` and `STREAM_SECRET` are not in the committed `.env`.

- `lib/crypto.js` throws immediately if `LINE_PASSWORD_SECRET` is missing during any line password operation
- `services/securityService.js` fails stream URL signing without `STREAM_SECRET`
- Result: **Line creation crashes. No streams play.**

**Fix Steps:**

1. Add to `.env`:
   ```
   LINE_PASSWORD_SECRET=<openssl rand -hex 32>
   STREAM_SECRET=<openssl rand -hex 32>
   ```
2. Add startup assertion in `server.js` (after dotenv load):
   ```js
   const REQUIRED = [
     'SESSION_SECRET',
     'LINE_PASSWORD_SECRET',
     'STREAM_SECRET',
     'DB_PASSWORD',
   ];
   for (const key of REQUIRED) {
     if (!process.env[key]) {
       console.error(`FATAL: Missing required env var: ${key}`);
       process.exit(1);
     }
   }
   ```

**Files:** `.env`, `server.js`

---

### [P1.3] Fix apiKeyLimiter Duplicate `skip` Key ✅

**Problem:** `middleware/rateLimiter.js` defines `skip:` twice on the `apiKeyLimiter` config object. In JavaScript, duplicate object keys mean the second definition silently overwrites the first. The intended "skip if no API key header present" logic is dead code.

**Fix:** Replace the two separate `skip:` definitions with one merged function:

```js
// middleware/rateLimiter.js
skip: (req) => {
  const hasKey = !!(req.headers['x-api-key'] || req.headers['authorization']);
  if (!hasKey) return true;                    // no key = skip (let authLimiter handle)
  return isDevAuthLimitDisabled();             // dev bypass
},
```

**Files:** `middleware/rateLimiter.js`

---

### [P1.4] Fix adminLimiter — Rate-Limit Unauthenticated Requests ✅

**Problem:** `adminLimiter` in `middleware/rateLimiter.js` has this logic:

```js
skip: (req) => {
  if (!req.session.userId) return true;  // ← BUG: unauthenticated = unlimited
  ...
}
```

This means unauthenticated requests to admin endpoints are completely unrate-limited. An attacker can probe any admin endpoint at full speed before logging in.

**Fix:**

```js
keyGenerator: (req) => {
  if (!req.session?.userId) return req.ip;   // rate-limit unauthed by IP
  return `${req.session.userId}|${req.session.portalRole}|${req.session.accessCodeId}`;
},
skip: (req) => isLocalhost(req) && process.env.ALLOW_LOCAL_NO_RATELIMIT === '1',
```

Remove the `if (!req.session?.userId) return true` skip entirely.

**Files:** `middleware/rateLimiter.js`

---

### [P1.5] Fix requireAdminAuth — Missing Error Handler ✅

**Problem:** `lib/panel-access.js` — `requireAuth` wraps its async DB call with `.catch(next)`, but `requireAdminAuth` does not. A MariaDB error during admin auth propagates as an unhandled promise rejection, bypassing the error middleware and potentially crashing the process.

**Fix:**

```js
// lib/panel-access.js
requireAdminAuth: async (req, res, next) => {
  try {
    // ... existing auth logic
  } catch (err) {
    next(err);
  }
};
```

**Files:** `lib/panel-access.js`

---

### [P1.6] Fix Default Access Codes ✅

**Problem:** `DEFAULT_ADMIN_ACCESS_CODE=admin` and `DEFAULT_RESELLER_ACCESS_CODE=reseller` in `.env.example`. If anyone deploys without changing these, the access-code gateway is trivially bypassed.

**Fix:**

1. Change seed script to generate random codes if defaults are detected:
   ```js
   // scripts/seed.js
   if (['admin', 'reseller'].includes(process.env.DEFAULT_ADMIN_ACCESS_CODE)) {
     console.error(
       'ERROR: Change DEFAULT_ADMIN_ACCESS_CODE from the default value before seeding.'
     );
     process.exit(1);
   }
   ```
2. Update `.env.example` with a comment:
   ```
   DEFAULT_ADMIN_ACCESS_CODE=CHANGE_ME_USE_RANDOM_STRING
   DEFAULT_RESELLER_ACCESS_CODE=CHANGE_ME_USE_RANDOM_STRING
   ```

**Files:** `scripts/seed.js`, `.env.example`

---

## Priority 2 — HIGH (Fix Before Beta / First Real Users)

---

### [P2.1] Fix Session Fixation — Migrate to express-session ✅

**Problem:** The app uses `cookie-session` which stores session data inside the cookie itself and has no `session.regenerate()` method. This means the session identifier (cookie value) is never rotated on login, enabling session fixation attacks.

**Fix:** Migrate to `express-session` with Redis store:

1. Install:

   ```bash
   npm install express-session connect-redis
   npm uninstall cookie-session
   ```

2. Replace in `server.js`:

   ```js
   const session = require('express-session');
   const RedisStore = require('connect-redis').default;

   app.use(
     session({
       store: new RedisStore({ client: redisClient }),
       secret: process.env.SESSION_SECRET,
       name: 'nsp.sid',
       resave: false,
       saveUninitialized: false,
       cookie: {
         httpOnly: true,
         sameSite: 'lax',
         secure: isProduction,
         maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
       },
     })
   );
   ```

3. In login handler (`routes/auth.js`), after credential verification:

   ```js
   const previousSession = req.session;
   req.session.regenerate((err) => {
     if (err) return next(err);
     req.session.userId = user.id;
     req.session.portalRole = previousSession.portalRole;
     req.session.accessCodeId = previousSession.accessCodeId;
     req.session.accessCode = previousSession.accessCode;
     res.json({ success: true });
   });
   ```

4. Update `lib/panel-session.js` to remove `cookie-session` option exports

**Files:** `server.js`, `lib/panel-session.js`, `routes/auth.js`, `package.json`

---

### [P2.2] Re-enable Helmet CSP ✅

**Problem:** `middleware/securityHeaders.js` has Content Security Policy completely disabled. Any XSS attack in the admin panel is fully exploitable.

**Step 1 — Remove inline handlers from SPA shells:**

Audit `public/index.html`, `public/reseller.html`, `public/client.html` for all inline:

- `onclick="..."` attributes
- `onchange="..."` attributes
- `onsubmit="..."` attributes

Move each to delegated event listeners in the corresponding `pages/*.js` module using `document.addEventListener` or element `.addEventListener()`.

**Step 2 — Enable CSP in `middleware/securityHeaders.js`:**

```js
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],     // allow inline styles initially
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "wss:", "ws:"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  }
},
```

**Step 3 — Test** each SPA page to confirm no breakage. Then progressively tighten `styleSrc`.

**Files:** `middleware/securityHeaders.js`, `public/index.html`, `public/reseller.html`, `public/client.html`

---

### [P2.3] Enable HSTS by Default in Production ✅

**Problem:** HSTS is gated behind `ENABLE_HSTS=true` env var, so it's off unless explicitly enabled. A missed env var means HTTP downgrade attacks are possible.

**Fix:**

```js
// middleware/securityHeaders.js
hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
```

Remove the `ENABLE_HSTS` env var dependency for production.

**Files:** `middleware/securityHeaders.js`

---

### [P2.4] Apply Joi Validation to All Admin Routes ✅

**Problem:** `middleware/validation.js` has a complete Joi factory system, but most `routes/admin.*.js` files parse body with inline helpers (`parseLimitOffset`, `parseBoolInt`, `parseOptionalNumber`) instead.

**Fix Plan:**

1. Define schemas in `middleware/schemas/` — one file per domain:
   - `schemas/line.js` — line create, update, query
   - `schemas/channel.js`, `schemas/movie.js`, `schemas/series.js`, etc.
2. Apply as middleware:

   ```js
   // routes/admin.lines.js
   const { validateBody, validateQuery } = require('../middleware/validation');
   const {
     lineCreateSchema,
     lineUpdateSchema,
   } = require('../middleware/schemas/line');

   router.post(
     '/',
     csrfProtection,
     validateBody(lineCreateSchema),
     asyncHandler(async (req, res) => {
       // req.body is now validated and sanitized
     })
   );
   ```

3. Remove inline `parseLimitOffset`, `parseBoolInt` etc. from route handlers

**Files:** All `routes/admin.*.js`, `middleware/validation.js`, new `middleware/schemas/*.js`

---

### [P2.5] Add Health Check Endpoint ✅

**Problem:** No `/health` or `/healthz` endpoint. Load balancers and monitoring tools (PM2, uptime monitors) cannot verify the server is alive without probing application logic.

**Fix:**

```js
// server.js — add before auth middleware
app.get('/health', async (req, res) => {
  try {
    await db.queryOne('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});
```

**Files:** `server.js`

---

### [P2.6] Fix or Remove Cloud Backup Stub ✅

**Problem:** `services/cloudBackup.js` line 106 explicitly writes: "stores the encrypted file locally as a 'cloud' backup." The Settings UI shows a cloud backup option that users will trust. It does not upload to any cloud service.

**Option A — Remove:** Hide the cloud backup option in the UI with a "Coming Soon" label until implemented.

**Option B — Implement:** Add real S3/R2/GCS upload:

```bash
npm install @aws-sdk/client-s3
```

Required new env vars: `CLOUD_BACKUP_PROVIDER`, `CLOUD_BACKUP_BUCKET`, `CLOUD_BACKUP_ENDPOINT`, `CLOUD_BACKUP_KEY`, `CLOUD_BACKUP_SECRET`

**Files:** `services/cloudBackup.js`, relevant settings UI in `public/js/src/pages/backups.js`

---

### [P2.7] Cache Access Code Validation Per Request (N+1 Fix) ✅

**Problem:** `lib/panel-access.js` calls `validatePanelAccessCodeSession()` which hits the DB on every authenticated request to verify the access code row. At high concurrency this is N+1 DB calls.

**Fix:** Cache the result on `req` (per-request memoization) and add a short Redis TTL cache:

```js
// lib/panel-access.js
async function validatePanelAccessCodeSession(req) {
  if (req._accessCodeValidated) return req._accessCodeValidated;

  const cacheKey = `ac:${req.session.accessCodeId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    req._accessCodeValidated = JSON.parse(cached);
    return req._accessCodeValidated;
  }

  const code = await db.getAccessCodeById(req.session.accessCodeId);
  if (code) {
    await redis.setex(cacheKey, 60, JSON.stringify(code)); // 60s TTL
    req._accessCodeValidated = code;
  }
  return req._accessCodeValidated;
}
```

**Files:** `lib/panel-access.js`

---

## Priority 3 — MEDIUM (Fix Within Second Sprint)

---

### [P3.1] Complete Line Password Migration ✅

**Problem:** The `lines` table has three password columns in a partially-migrated state:

- `password` — legacy plaintext (should not exist)
- `password_hash` — bcrypt (current for verification)
- `password_enc` — AES-256-GCM (current for display in admin)

**Fix:**

1. Run `ensureLinePasswordSecurityColumns()` and `migrateLegacyLinePasswords()` on all environments
2. Verify all rows have `password_hash` and `password_enc` populated
3. Write and run migration to drop the `password` column:
   ```sql
   -- scripts/migrations.js — add new migration step:
   ALTER TABLE lines DROP COLUMN IF EXISTS password;
   ```
4. Remove legacy auth path in `lineService.js` that checks the plain `password` column

**Files:** `scripts/migrations.js`, `repositories/lineRepository.js`, `services/lineService.js`

---

### [P3.2] Normalize Timestamp Convention ✅

**Problem:** Some tables use `INT UNSIGNED` UNIX timestamps, others use `DATETIME`. Mixing these makes joins, range queries, and reporting code inconsistent and error-prone.

**Fix:** Standardize on `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`.

Write a migration for each `INT UNSIGNED` timestamp column:

```sql
-- Example:
ALTER TABLE lines_activity
  MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- (Populate: UPDATE lines_activity SET created_at = FROM_UNIXTIME(created_at) WHERE ...)
-- Then modify column type
```

Document in `CLAUDE.md` that all new tables must use DATETIME.

**Files:** `scripts/schema.sql`, `scripts/migrations.js`, affected repositories

---

### [P3.3] Add Optimistic Locking to Channel JSON Blob ✅

**Problem:** `channels.json_data MEDIUMTEXT` stores the entire channel config as JSON. Concurrent admin edits and the stability monitor both read-modify-write this blob with no locking, so updates can be silently lost.

**Fix:**

1. Add `version` column:
   ```sql
   ALTER TABLE channels ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
   ```
2. Update `repositories/channelRepository.js` update function:
   ```js
   async function updateChannel(id, data, expectedVersion) {
     const result = await db.execute(
       'UPDATE channels SET json_data=?, version=version+1 WHERE id=? AND version=?',
       [JSON.stringify(data), id, expectedVersion]
     );
     if (result.affectedRows === 0)
       throw new ConflictError('Channel was modified by another process');
   }
   ```
3. Update callers to pass and receive the version

**Files:** `scripts/migrations.js`, `repositories/channelRepository.js`, `services/channelConfig.js`, `services/stabilityMonitorService.js`

---

### [P3.4] Add Audit Log Table ✅

**Problem:** Security-relevant events (login, admin changes, line create/delete) only go to Winston log files. There is no queryable DB audit trail for compliance or investigation.

**Fix:**

1. Add table:
   ```sql
   CREATE TABLE audit_log (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     user_id INT UNSIGNED,
     action VARCHAR(100) NOT NULL,
     resource_type VARCHAR(50),
     resource_id VARCHAR(100),
     ip_address VARCHAR(45),
     user_agent TEXT,
     meta JSON,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_user_id (user_id),
     INDEX idx_action (action),
     INDEX idx_created_at (created_at)
   ) ENGINE=InnoDB;
   ```
2. Create `repositories/auditLogRepository.js`
3. Create `services/auditService.js` with `log(userId, action, resourceType, resourceId, meta, req)` helper
4. Call from login, logout, line CRUD, channel CRUD, settings change, server add/remove
5. Add admin UI page to view audit log with filtering (optional second phase)

**Files:** `scripts/schema.sql`, `scripts/migrations.js`, new `repositories/auditLogRepository.js`, new `services/auditService.js`, `routes/auth.js`, `routes/admin.lines.js`, `routes/admin.channels.js`, `routes/admin.settings.js`

---

### [P3.5] Promote unhandledRejection to Trigger Shutdown ✅

**Problem:** `server.js` only logs `unhandledRejection` events. Silent failures can leave the server in an inconsistent state.

**Fix:**

```js
// server.js
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason, promise });
  // In production, treat as fatal — initiate graceful shutdown
  if (isProduction) {
    gracefulShutdown('UNHANDLED_REJECTION');
  }
});
```

**Files:** `server.js`

---

## Priority 4 — LOW (Backlog / Cleanup Sprint)

---

### [P4.1] Remove Committed Build Artifacts and Junk Files ✅

**Problem:** Multiple files are committed that should not be in the repo, bloating it and leaking information.

**Fix:**

```bash
# Add to .gitignore
cat >> .gitignore << 'EOF'
public/js/dist/
public/js/dist/**/*.map
coverage/
.DS_Store
**/.DS_Store
data/*.db
data/*.db-shm
data/*.db-wal
logs/
EOF

# Remove from tracking
git rm -r --cached public/js/dist/ coverage/ .DS_Store
git rm --cached data/app.db data/db.sqlite data/restream.db 2>/dev/null || true
git commit -m "chore: remove build artifacts and generated files from tracking"
```

Add `npm run build:frontend` step to CI/CD instead of committing dist.

**Files:** `.gitignore`, git history cleanup

---

### [P4.2] Decompose God-Files ✅

**Problem:** Several files are too large and have multiple responsibilities, making them hard to test and maintain.

**server.js (700 lines)** — Split into:

- `app.js` — Express instance, middleware stack, static files
- `bootstrap/db.js` — MariaDB + Redis init
- `bootstrap/routes.js` — Route mounting
- `bootstrap/streaming.js` — FFmpeg lifecycle, prebuffer, stability monitor
- `bootstrap/jobs.js` — Cron jobs, Telegram, webhooks

**serverService.js (1059 lines)** — Split into:

- `serverSelectionService.js` — capacity selection, load balancing
- `serverRuntimeService.js` — runtime session reconciliation
- `serverProxyService.js` — URL resolution, public base URL

**channelConfig.js (859 lines)** — Split by responsibility:

- `channelOptionsMerger.js` — option merging
- `channelSourceDetector.js` — input type classification
- `channelFactory.js` — channel object creation

**Files:** `server.js`, `services/serverService.js`, `services/channelConfig.js`

---

### [P4.3] Hide Cloud Backup Until Real Implementation Exists ✅

_(Dependency: P2.6 must decide direction first)_

If implementing S3/R2/GCS:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
```

New `.env` vars needed:

```
CLOUD_BACKUP_PROVIDER=s3
CLOUD_BACKUP_ENDPOINT=https://s3.amazonaws.com
CLOUD_BACKUP_BUCKET=my-iptv-backups
CLOUD_BACKUP_KEY=<access-key-id>
CLOUD_BACKUP_SECRET=<secret-access-key>
CLOUD_BACKUP_REGION=us-east-1
```

**Files:** `services/cloudBackup.js`, `.env.example`

---

### [P4.4] PM2 Cluster Mode + Redis Session Store 🔴

**Problem:** PM2 runs a single Node.js process. Multiple CPU cores are wasted. Cluster mode requires shared session state (already done by migrating to express-session + Redis in P2.1) and shared in-memory state.

**Fix:**

1. Move `lib/state.js` Maps to Redis hashes (channels Map → Redis hash `channel:state:<id>`)
2. Update `ecosystem.config.cjs`:
   ```js
   instances: 'max',
   exec_mode: 'cluster',
   ```

**Files:** `lib/state.js`, `ecosystem.config.cjs`, anything that reads from `state.channels`, `state.processes`

---

### [P4.5] Add Docker + docker-compose ✅

**Fix:** Create `Dockerfile` and `docker-compose.yml`:

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build:frontend
EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
services:
  panel:
    build: .
    ports: ['3000:3000']
    env_file: .env
    depends_on: [mariadb, redis]

  mariadb:
    image: mariadb:11
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MARIADB_DATABASE: ${DB_NAME}
      MARIADB_USER: ${DB_USER}
      MARIADB_PASSWORD: ${DB_PASSWORD}
    volumes: [mariadb_data:/var/lib/mysql]

  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]

volumes:
  mariadb_data:
  redis_data:
```

**Files:** New `Dockerfile`, `docker-compose.yml`, `.dockerignore`

---

### [P4.6] Add Unit Tests for Security-Critical Modules ✅

Priority modules with no or low test coverage that handle security:

| Module                        | What to test                                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| `lib/crypto.js`               | encrypt/decrypt round-trip, throws when secret missing, bcrypt verify |
| `lib/panel-access.js`         | requireAuth blocks unauthenticated, requireAdminAuth blocks non-admin |
| `middleware/rateLimiter.js`   | limits trigger at threshold, skip logic correct                       |
| `middleware/csrf.js`          | blocks requests without token, passes with valid token                |
| `services/securityService.js` | HMAC token sign/verify, TTL expiry                                    |
| `services/lineService.js`     | geo block, IP block, bouquet enforcement                              |

**Files:** `tests/unit/lib/crypto.test.js`, `tests/unit/lib/panel-access.test.js`, `tests/unit/middleware/rateLimiter.test.js`, `tests/unit/services/securityService.test.js`

---

### [P4.7] Consolidate Install Scripts ✅

**Problem:** Both `install` and `install.sh` exist. Unclear which is canonical.

**Fix:**

1. Compare the two files
2. Keep `install.sh`, delete `install`
3. Verify `auto_install_ubuntu.sh` in `scripts/` is in sync with current `package.json` dependencies
4. Update README/docs to point to canonical install script

**Files:** `install`, `install.sh`, `scripts/auto_install_ubuntu.sh`

---

## Sprint Schedule

| Sprint              | Items       | Focus                                              |
| ------------------- | ----------- | -------------------------------------------------- |
| Sprint 1 (Week 1)   | P1.1 → P1.6 | Security hardening — secrets, crashes, rate limits |
| Sprint 2 (Week 2)   | P2.1 → P2.7 | Session security, CSP, validation, health check    |
| Sprint 3 (Week 3–4) | P3.1 → P3.5 | Data layer cleanup, audit log, stability           |
| Backlog             | P4.1 → P4.7 | Cleanup, Docker, cluster mode, tests               |

---

## Completion Tracker

| ID   | Title                                                      | Priority | Status |
| ---- | ---------------------------------------------------------- | -------- | ------ |
| P1.1 | Rotate committed secrets                                   | Critical | ✅     |
| P1.2 | Set missing env vars (LINE_PASSWORD_SECRET, STREAM_SECRET) | Critical | ✅     |
| P1.3 | Fix apiKeyLimiter duplicate skip key                       | Critical | ✅     |
| P1.4 | Fix adminLimiter unauthenticated bypass                    | Critical | ✅     |
| P1.5 | Fix requireAdminAuth error handler                         | Critical | ✅     |
| P1.6 | Fix default access codes                                   | Critical | ✅     |
| P2.1 | Session fixation fix (express-session + Redis)             | High     | ✅     |
| P2.2 | Re-enable Helmet CSP                                       | High     | ✅     |
| P2.3 | Enable HSTS by default in production                       | High     | ✅     |
| P2.4 | Apply Joi validation to all admin routes                   | High     | ✅     |
| P2.5 | Add health check endpoint                                  | High     | ✅     |
| P2.6 | Fix or remove cloud backup stub                            | High     | ✅     |
| P2.7 | Cache access code validation (N+1 fix)                     | High     | ✅     |
| P3.1 | Complete line password migration                           | Medium   | ✅     |
| P3.2 | Normalize timestamp convention                             | Medium   | ✅     |
| P3.3 | Add optimistic locking to channel JSON blob                | Medium   | ✅     |
| P3.4 | Add audit log table + service                              | Medium   | ✅     |
| P3.5 | Promote unhandledRejection to trigger shutdown             | Medium   | ✅     |
| P4.1 | Remove committed build artifacts                           | Low      | ✅     |
| P4.2 | Decompose god-files (server.js, serverService.js)          | Low      | ✅     |
| P4.3 | Hide cloud backup until real implementation exists         | Low      | ✅     |
| P4.4 | PM2 cluster mode + Redis shared state                      | Low      | 🔴     |
| P4.5 | Add Docker + docker-compose                                | Low      | ✅     |
| P4.6 | Unit tests for security-critical modules                   | Low      | ✅     |
| P4.7 | Consolidate install scripts                                | Low      | ✅     |

---

## Post-Audit Follow-up Items (2026-04-08 Re-Analysis)

> New issues found during full re-audit after P1–P4 implementation. Not blockers but worth fixing.

| ID  | Issue                                                                                                              | File                                 | Priority   | Status |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------- | ------ |
| F1  | `docker-compose.yml` has `change_me_*` placeholder secrets — must warn or block on these                           | `docker-compose.yml`                 | High (ops) | ✅     |
| F2  | `routes/auth.js` login 500 handler leaks `e.message` to client response                                            | `routes/auth.js:164`                 | Medium     | ✅     |
| F3  | `lineRepository::listLines` returns `password_hash`/`password_enc` in SQL select — should exclude at query level   | `repositories/lineRepository.js`     | Medium     | ✅     |
| F4  | Audit log coverage — verify line/channel/settings/server CRUD all call `auditService.log`                          | `services/auditService.js`           | Medium     | ✅     |
| F5  | `lib/boot/db.js` and `lib/boot/jobs.js` use `console.*` instead of `services/logger`                               | `lib/boot/db.js`, `lib/boot/jobs.js` | Low        | ✅     |
| F6  | `services/cloudBackup.js::uploadToGoogleDrive` has dead code after `throw`                                         | `services/cloudBackup.js`            | Low        | ✅     |
| F7  | `audit_log.user_agent` is unbounded TEXT — truncate in `auditService.log` to VARCHAR(512)                          | `services/auditService.js`           | Low        | ✅     |
| F8  | `cloudBackup.js::encryptFile` uses 16-byte IV — GCM standard is 12 bytes (matches `lib/crypto.js`)                 | `services/cloudBackup.js`            | Low        | ✅     |
| F9  | `routes/auth.js` logout fires `auditService.log` without `.catch()` — should add `.catch(() => {})`                | `routes/auth.js:171`                 | Low        | ✅     |
| F10 | `package.json` lint script ends with `\|\| true` — silently swallows all lint failures                             | `package.json`                       | Low        | ✅     |
| F11 | No unit/integration tests for `/health` and `/readyz` endpoints                                                    | `tests/`                             | Low        | ✅     |
| F12 | `lib/boot/routes.js` captures `maxFFmpegProcesses` at boot time — later runtime changes not reflected in dashboard | `lib/boot/routes.js`                 | Low        | ✅     |
