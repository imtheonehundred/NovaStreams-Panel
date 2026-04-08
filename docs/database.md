# Database Documentation

> Last updated: 2026-04-08 (post P3 migrations)

## Overview

- **Engine:** MariaDB ≥10.6 (MySQL 8 compatible)
- **Character set:** utf8mb4 / utf8mb4_unicode_ci
- **Connection:** mysql2 pool (default size: 20)
- **Access:** Only through `repositories/` modules — never raw SQL in routes or services
- **Timestamps:** `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` (INT UNSIGNED columns migrated in P3.2)

---

## Schema Overview

### Users & Access

| Table | Purpose |
|---|---|
| `users` | All portal users (admin, reseller, client role) |
| `user_groups` | Permission groups for users |
| `api_keys` | API key credentials (bcrypt-hashed, 12-char prefix indexed) |
| `access_codes` | Portal gateway access codes per role |
| `credits_logs` | Reseller credit debit/credit history |
| `audit_log` | Queryable security and admin event log (added P3.4) |

### Subscribers (Lines)

| Table | Purpose |
|---|---|
| `lines` | Subscriber accounts (username, password_hash, password_enc, expiry, connections) |
| `lines_activity` | Per-line activity events |

**Note (P3.1 complete):** The legacy `password` (plaintext) column has been dropped. Only `password_hash` (bcrypt) and `password_enc` (AES-256-GCM) remain.

### Streaming & Channels

| Table | Purpose |
|---|---|
| `channels` | Live channel definitions — config as `json_data MEDIUMTEXT` + `version INT UNSIGNED` |
| `channel_health` | Health probe results per channel |
| `qoe_metrics` | Quality of Experience metrics (raw) |
| `qoe_agg` | Aggregated QoE data |
| `stream_categories` | Categories for live streams |

**Note (P3.3 complete):** `channels.version` enables optimistic locking — concurrent admin edits and the stability monitor are now protected against lost updates.

### VOD & Media

| Table | Purpose |
|---|---|
| `movies` | Movie entries |
| `series` | Series definitions |
| `episodes` | Episode entries linked to series |

### Organization

| Table | Purpose |
|---|---|
| `bouquets` | Channel/content groupings |
| `packages` | Subscription packages |
| `reseller_package_overrides` | Per-reseller package customizations |
| `reseller_expiry_media_services` | Reseller expiry media service configs |
| `reseller_expiry_media_items` | Items in expiry media services |

### EPG

| Table | Purpose |
|---|---|
| `epg_sources` | EPG source URLs |
| `epg_channels` | EPG channel mapping |
| `epg_data` | Programme data (timestamps normalized to DATETIME) |

### Security & Audit

| Table | Purpose |
|---|---|
| `blocked_ips` | Manually blocked IPs |
| `blocked_user_agents` | Blocked UA strings |
| `blocked_isps` | Blocked ISP names |
| `auth_flood` | Auth attempt tracking per IP |
| `security_events` | Security incident log |
| `audit_log` | Full admin/auth action audit trail |

### Infrastructure

| Table | Purpose |
|---|---|
| `servers` | Remote streaming node definitions |
| `server_relationships` | Channel-to-server assignments |
| `server_runtime_sessions` | Active stream sessions per server |
| `import_providers` | Xtream/M3U import provider configs |
| `transcode_profiles` | FFmpeg transcode presets |
| `drm_streams` | DRM-protected stream configs |
| `panel_logs` | Application activity log |
| `settings` | Key-value application settings |

---

## Repository Pattern

```
lib/db.js               ← import this in routes/services
  ↓ re-exports from:
repositories/*.js       ← write SQL here only
  ↓ uses:
lib/mariadb.js          ← connection pool wrapper
```

### mariadb.js API

```js
const { query, queryOne, insert, update, remove, execute } = require('../lib/mariadb');

const rows   = await query('SELECT * FROM lines WHERE reseller_id = ?', [id]);
const line   = await queryOne('SELECT * FROM lines WHERE id = ?', [id]);
const newId  = await insert('lines', { username, password_hash, expiry_date });
await update('lines', { max_connections: 5 }, 'id = ?', [lineId]);
await remove('lines', 'id = ?', [lineId]);
await execute('ALTER TABLE lines ADD COLUMN ...');
```

All queries use `?` parameterized placeholders. No user input is ever interpolated into SQL strings.

---

## Optimistic Locking (Channels)

`channels.version INT UNSIGNED` is incremented on every update:

```js
// repositories/channelRepository.js
const result = await execute(
  'UPDATE channels SET json_data=?, version=version+1 WHERE id=? AND version=?',
  [JSON.stringify(data), id, expectedVersion]
);
if (result.affectedRows === 0) {
  throw new ConflictError('Channel modified by another process', { channelId: id, currentVersion });
}
```

Callers catch `ConflictError`, re-read the current version, and retry.

---

## Schema Conventions

| Convention | Standard |
|---|---|
| Primary keys | `id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY` |
| Timestamps | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| Soft deletes | Not used — hard deletes only |
| Channel config | `json_data MEDIUMTEXT` + `version INT UNSIGNED` |
| Booleans | `TINYINT(1)` with values 0/1 |
| Strings | `VARCHAR(255)` default, `VARCHAR(100)` for usernames/codes |

---

## Migrations

All schema changes must update both:
1. `scripts/schema.sql` — for fresh installs
2. `scripts/migrations.js` — for existing installs (safe to re-run)

```js
// scripts/migrations.js — add to migrations array
{
  version: '20260408_your_change',
  up: async (db) => {
    await db.execute(`ALTER TABLE your_table ADD COLUMN ...`);
  }
}
```

Run migrations:
```bash
npm run bootstrap-db   # runs schema + all migrations (idempotent)
```

---

## Completed Migrations (P3)

| Migration | What it did |
|---|---|
| `dropLegacyLinePasswordColumnIfSafe` | Dropped `lines.password` after verifying all rows have `password_hash`+`password_enc` |
| `normalizeLegacyTimestampColumns` | Converted INT UNSIGNED timestamps to DATETIME using `FROM_UNIXTIME()` |
| `ensureChannelsVersionColumn` | Added `channels.version` for optimistic locking |
| `ensureAuditLogTable` | Created `audit_log` table with indexes |

---

## Known Issues

| Issue | Impact | Status |
|---|---|---|
| `lineRepository::listLines` returns `password_hash`/`password_enc` in SQL select | Hash could leak to callers not using `normalizeLineRow` | F3 🔴 |
| `audit_log.user_agent` is unbounded TEXT | Log bloat from long UAs | F7 🔴 |
| `channels.json_data` is a schemaless blob | No SQL queryability on channel properties | Accepted — use version column for concurrency |
