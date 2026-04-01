# Database Map

## Persistence Stack

This repository uses four persistence layers:

| Layer | Role |
| --- | --- |
| MariaDB | primary long-lived application database |
| Redis | cache, ephemeral connection state, sharing history, health/bandwidth history |
| Filesystem | streams, logs, watermarks, backups, `user_meta.json` |
| In-memory Maps | live runtime process state, websocket activity, session tokens, viewer counters |

## Schema Size

Current schema file `scripts/schema.sql` defines `48` tables.

## Main Entity Groups

### Panel Users And Access

Tables:
- `users`
- `user_groups`
- `access_codes`
- `api_keys`
- `credits_logs`
- `roles`
- `permissions`
- `role_permissions`

Reality:
- admin/reseller auth uses `users` plus `user_groups.is_admin` and `user_groups.is_reseller`
- RBAC tables exist but enforcement is still mostly coarse role checking

### Subscriber And Playback Access

Tables:
- `lines`
- `lines_activity`
- `line_runtime_sessions`

Reality:
- `lines` is the subscriber account table
- `lines_activity` is historical connection logging
- `line_runtime_sessions` is the newer runtime-session truth table, but not every playback path writes to it equally

### Content And Catalog

Tables:
- `channels`
- `stream_categories`
- `bouquets`
- `packages`
- `movies`
- `series`
- `episodes`
- `epg_sources`
- `epg_data`
- `transcode_profiles`
- `import_providers`

### Server Area / Distributed Runtime

Tables:
- `streaming_servers`
- `streaming_server_domains`
- `server_relationships`
- `stream_server_placement`
- `server_commands`
- `server_agent_credentials`
- `server_provisioning_jobs`

Reality:
- this is the schema behind the multi-node/server-area story
- the schema is broader than the currently implemented remote live runtime

### Monitoring / Security / Operations

Tables:
- `channel_health`
- `qoe_metrics`
- `qoe_agg`
- `blocked_ips`
- `blocked_uas`
- `blocked_isps`
- `blocked_asns`
- `login_events`
- `panel_logs`
- `backups`
- `plex_servers`

## Data Shape Reality

Important JSON/text-heavy areas:
- `channels.json_data`
- `packages.groups_json`
- `packages.bouquets_json`
- `packages.output_formats_json`
- `packages.options_json`
- `streaming_servers.meta_json`
- `stream_server_placement.stream_info_json`
- `profiles.profile_options`
- `movies.stream_source`
- `series.seasons`
- `episodes.info_json`

This means several core domains are only partially relational. The DB stores blobs that the application interprets later.

## Risky Persistence Patterns

### Channel Persistence As JSON Blob

`channels` stores most channel state in `json_data`, then `server.js` loads it into memory and rewrites it back.

Implication:
- schema-level validation is weak
- queryability is weak
- runtime and storage shape are tightly coupled

### Split Runtime Truth

The system stores runtime-relevant data in multiple places:
- MariaDB placement/session tables
- Redis connection keys
- in-memory runtime maps

Implication:
- truth is partial and path-dependent
- dashboards can be directionally correct but still incomplete

### Mixed Security Storage

The `lines` table still includes:
- `password`
- `password_hash`
- `password_enc`

Code migrates toward hash plus encrypted recovery, but the schema still reflects legacy compatibility.

### File-Based User Metadata

`services/userService.js` stores API playback user meta in `data/user_meta.json`.

Implication:
- some user state is outside MariaDB
- backup/restore and multi-node behavior are less predictable for this path

## Migration Model

Migration model today is mixed:
- formal schema file: `scripts/schema.sql`
- bootstrap seed path: `scripts/bootstrap-database.js`
- ad hoc ensure-and-alter helpers inside `lib/db.js`
- standalone one-off SQL files in `scripts/`

This is not a clean migration system.

The database evolves through runtime `ensure*()` functions as much as through explicit migrations.

## Drift And Safety Notes

Observed drift indicators:
- `scripts/add-db-indexes.sql` references `channels.status`, but the real `channels` table does not have a `status` column
- old SQLite language still exists in comments and some historical docs, while the active system is MariaDB

## Secrets And Plaintext Risk

Plaintext or weakly protected storage still exists in important places:
- local `.env` contains live secrets in this workspace copy
- `streaming_servers.admin_password`
- cloud backup provider settings
- `plex_servers.plex_token`
- `lines.access_token`

Better areas:
- API keys are hashed
- line passwords are verified with bcrypt hashes

But overall secret hygiene is still weak.

## Production Safety Assessment

| Area | Assessment |
| --- | --- |
| Core MariaDB usage | Reasonable |
| Channel schema design | Risky because of `json_data` blobs |
| Migration discipline | Weak |
| Secret storage | Weak |
| Runtime truth consistency | Partial |
| Backup persistence | Local path is real, cloud path is not |

## Practical Conclusion

The database is large enough for a real product, but not yet disciplined enough to be called cleanly production-safe.

The biggest issues are not table count or missing features. They are drift, mixed truth models, and sensitive data handling.
