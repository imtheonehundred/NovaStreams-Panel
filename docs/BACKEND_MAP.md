# Backend Map

## Backend Entry Point

`server.js` is the real backend core.

It is not just a bootstrap file. It still owns:
- Express app construction
- session and gateway auth setup
- static shell gating
- HLS and MPEG-TS local serving
- channel load/persist helpers
- channel-option normalization
- imported-channel creation
- watermarks, QoE, probe, movie-channel, and DB helper endpoints
- the local FFmpeg runtime engine
- boot lifecycle and subsystem startup

## Route Ownership

| File | Mount / Path | Ownership |
| --- | --- | --- |
| `routes/auth.js` | `/api/auth` | panel login, logout, `/me`, API keys |
| `routes/admin.js` | `/api/admin` | admin CRUD, monitoring, server area, imports, settings, security, backups, Plex, Telegram |
| `routes/reseller.js` | `/api/reseller` | reseller lines, profile, credits, package/bouquet access |
| `routes/client.js` | `/api/client` | subscriber self-service |
| `routes/channels.js` | `/api/channels*` | live-channel CRUD, start/stop/restart, playback URLs, stability, QoE |
| `routes/drm.js` | `/api/drm-restreams*` | internal DRM restream CRUD and lifecycle |
| `routes/transcode.js` | `/api/transcode-profiles*` | transcode profile CRUD |
| `routes/playlist.js` | `/get.php` | M3U generation |
| `routes/xtream.js` | `/player_api.php`, `/xmltv.php`, `/api/xtream/*` | Xtream-compatible metadata and XMLTV |
| `routes/stream.js` | public `/live`, `/movie`, `/series` | subscriber playback auth and redirect/proxy logic |
| `routes/playback.js` | `/api/playback` | separate API playback token flow |
| `routes/dashboard.js` | `/api/dashboard` | dashboard metrics |
| `routes/agent.js` | `/api/agent` | heartbeat, command lease, command ACK |
| `routes/system.js` | `/api/health`, `/api/db-*` | lightweight health and DB helpers |

Inline routes still in `server.js`:
- access-code gateway routes
- `/streams/*`
- `/proxy/hls/:id` and `/proxy/seg/:id`
- local `/live/:channelId.ts`
- `/drm/:id/stream.ts`
- `/api/system/*` duplicates
- `/api/watermarks`
- `/api/qoe/report`
- `/api/probe`
- `/api/settings/ffmpeg-limits`
- movie-channel CRUD

## Service Ownership

| File | Purpose | Notes |
| --- | --- | --- |
| `services/lineService.js` | line auth, connection tracking, bouquet and playback policy checks | central to subscriber access control |
| `services/serverService.js` | server registry, selector, heartbeat health, failover, proxy relationships | most important distributed-runtime helper |
| `services/securityService.js` | stream signing, token validation, geo checks, sharing hooks | real security surface, but incomplete overall hardening |
| `services/playlistService.js` | M3U generation | one of the cleaner separations |
| `services/xtreamService.js` | Xtream payload builders | reasonably isolated |
| `services/importService.js` | import jobs for movies, series, live | broad side-effect surface |
| `services/vodService.js` | movie CRUD wrapper | thin wrapper around `dbApi` + bouquet sync |
| `services/seriesService.js` | series/episode CRUD wrapper | thin wrapper around `dbApi` + bouquet sync |
| `services/epgService.js` | XMLTV import/render | simple, direct implementation |
| `services/provisionService.js` | SSH provisioning and agent deployment | operationally risky |
| `services/backupService.js` | local `mysqldump` backup/restore | real functionality |
| `services/cloudBackup.js` | cloud backup config/encryption wrapper | uploads intentionally unsupported |
| `services/wsServer.js` | dashboard websocket server | cookie parsing + periodic dashboard broadcast |
| `services/streamManager.js` | alternative stream lifecycle engine and remote command queue helper | overlaps with `server.js` runtime engine |

## Lib Ownership

| File | Purpose |
| --- | --- |
| `lib/db.js` | giant DAO and seed/migration helper layer |
| `lib/mariadb.js` | connection pool and low-level query helpers |
| `lib/redis.js` | Redis connect/cache wrapper |
| `lib/state.js` | shared runtime maps |
| `lib/ffmpeg-args.js` | FFmpeg argument builder for copy/transcode/HLS/MPEG-TS/nginx mode |
| `lib/streaming-settings.js` | DB-plus-env runtime tuning cache |
| `lib/on-demand-live.js` | deduplicated on-demand start orchestration |
| `lib/public-stream-origin.js` | playback base URL resolution |
| `lib/crons.js` | scheduled maintenance/import/backup jobs |
| `lib/cache.js` | Redis cache middleware and invalidation helpers |

## What Lives In `server.js`

Large remaining ownership inside `server.js`:
- access-code gateway and admin/reseller shell routing
- `requireAuth`, `requireAdminAuth`, `requireApiKey`
- channel persistence helpers
- channel creation and option normalization
- local proxy HLS helpers
- MPEG-TS fan-out and prebuffer logic
- the real `startChannel()` / `stopChannel()` engine
- boot-time prewarm and idle-kill loops

This means most runtime-sensitive backend changes still require reading `server.js` first.

## Cleanly Separated Areas

Strong separations:
- playlist generation
- Xtream payload building
- server selection and public-base-url logic
- line permission checks
- EPG XMLTV rendering

## Monolithic Areas

Still monolithic:
- `server.js`
- `routes/admin.js`
- `lib/db.js`

These three files carry most of the architectural debt.

## Strongest Backend Areas

- Playlist and Xtream compatibility are organized better than the rest of the repo.
- The line model is fairly consistent across playlist, Xtream, and public playback.
- The server selector has a clear resolution order and is reused in multiple surfaces.

## Weakest Backend Areas

- Distributed live runtime is only partially implemented.
- Runtime truth is split across in-memory maps, Redis, placement tables, and session tables.
- Admin routes are too broad and mix many unrelated responsibilities.
- DB helper growth is ad hoc rather than strongly migration-driven.

## Backend Risk Files

| File | Why It Is Risky |
| --- | --- |
| `server.js` | central runtime and gateway ownership |
| `routes/admin.js` | huge operational and CRUD blast radius |
| `lib/db.js` | one shared DAO for almost every domain |
| `services/serverService.js` | selector/failover/proxy mistakes affect playback correctness |
| `routes/stream.js` | public playback auth and redirect logic |
| `routes/channels.js` | live-channel CRUD and lifecycle hooks |
| `services/importService.js` | large import side effects |
| `services/provisionService.js` | remote SSH/install side effects |
| `lib/ffmpeg-args.js` | FFmpeg behavior matrix is easy to regress |
| `services/streamManager.js` | overlapping runtime engine responsibilities |

## Practical Backend Conclusion

The backend is feature-rich and more mature than the missing documentation suggested, but it is still centered on a few oversized control files.

If future work ignores that reality, changes will look modular while still breaking the real execution path.
