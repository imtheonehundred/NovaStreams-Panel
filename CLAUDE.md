# CLAUDE.md

## Project Identity

`NovaStreams Panel` is a self-hosted IPTV restream and control panel.

It currently combines:
- an admin portal
- a reseller portal
- a small subscriber/client portal
- Xtream-compatible metadata endpoints
- M3U playlist generation
- a local FFmpeg-based live runtime
- partial multi-node server registry, heartbeat, failover, and proxy-delivery support

Business-wise, this repo is for an IPTV operator who needs to ingest live sources, manage lines/resellers/content, and publish playback through playlist, Xtream, and direct stream URLs.

Topology reality:
- Single-node core: real and working
- Hybrid/distributed extensions: real in schema and selector logic, partial in runtime ownership
- Commercial-grade multi-node orchestration: not complete

## Core Architecture

Primary entrypoints:
- `server.js`: real application orchestrator
- `agent/index.js`: remote heartbeat and movie/episode byte-serving agent
- `public/index.html`: admin shell
- `public/reseller.html`: reseller shell
- `public/client.html`: subscriber self-service shell

Authoritative backend ownership:
- `server.js`
  - Express bootstrap
  - cookie-session setup
  - access-code gateway routing
  - local FFmpeg stream lifecycle
  - `/streams/*`, `/proxy/*`, local `/live/:id.ts`, `/drm/:id/stream.ts`
  - inline QoE, watermark, probe, movie-channel, DB helper routes
  - boot lifecycle, WebSocket boot, crons, Telegram, webhooks
- `routes/admin.js`
  - very large admin API surface under `/api/admin`
- `routes/reseller.js`
  - reseller line/profile/credits/package access under `/api/reseller`
- `routes/client.js`
  - subscriber self-service under `/api/client`
- `routes/stream.js`
  - public subscriber playback routes for `/live`, `/movie`, `/series`
- `routes/playlist.js`
  - `/get.php`
- `routes/xtream.js`
  - `player_api.php`, `xmltv.php`

Important service ownership:
- `services/lineService.js`: line auth, connection rules, Redis live-connection tracking, runtime session helpers
- `services/serverService.js`: selector, public origin resolution, heartbeat health, failover, proxy relationships
- `services/securityService.js`: signed playback URLs, token validation, geo checks, sharing detection hooks
- `services/playlistService.js`: M3U generation
- `services/xtreamService.js`: Xtream metadata payloads
- `services/importService.js`: provider/M3U/XC import jobs
- `services/provisionService.js`: SSH-based remote provisioning
- `services/backupService.js`: local SQL dump backup/restore
- `services/cloudBackup.js`: cloud provider config surface, but uploads are de-scoped
- `services/wsServer.js`: dashboard websocket transport

## Frontend Structure

Admin frontend:
- shell: `public/index.html`
- controller: `public/js/app.js`
- modularized domains: `public/js/modules/*.js`

Reality:
- `app.js` is still the main admin orchestrator
- the admin shell is one large HTML file with many hidden page sections
- routing depends on `server.js` gateway segments, `public/js/modules/router.js`, and matching `page-*` section IDs
- `window.APP` is a compatibility contract and is still required by inline `onclick` handlers

Reseller frontend:
- shell: `public/reseller.html`
- controller: `public/js/reseller-app.js`
- global API surface: `window.RSL`

Client frontend:
- shell and logic both live in `public/client.html`
- global API surface: `CLIENT`

## Runtime And Streaming Rules

Do not casually break these contracts:
- `channels` are loaded from MariaDB `channels.json_data` into the in-memory `channels` map at boot
- `server.js` owns the real local live runtime via `startChannel()` and `stopChannel()`
- `services/streamManager.js` exists, but it is not the authoritative engine for the panel live path
- public line playback URL shapes must remain stable:
  - `/get.php`
  - `/player_api.php`
  - `/xmltv.php`
  - `/live/:username/:password/:file`
  - `/movie/:username/:password/:file`
  - `/series/:username/:password/:file`
- local stream serving contracts must remain stable:
  - `/streams/:channelId/*`
  - `/live/:channelId.ts`
  - `/drm/:id/stream.ts`
- `selectServer()` resolution order matters and should not be changed lightly:
  - `force_server_id`
  - content assignment (`stream_server_id` or effective episode inheritance)
  - `default_stream_server_id`
  - first enabled server fallback
  - settings/domain fallback
- distributed runtime truth is only partial today
  - `stream_server_placement` and `line_runtime_sessions` exist
  - remote live runtime start/stop is still de-scoped
- HLS/MPEG-TS token signing in `services/securityService.js` is a real playback contract

## Dangerous Files

High-blast-radius files:
- `server.js`
- `routes/admin.js`
- `lib/db.js`
- `public/js/app.js`
- `public/index.html`
- `services/serverService.js`
- `routes/stream.js`
- `lib/ffmpeg-args.js`
- `services/importService.js`
- `services/provisionService.js`

## Refactor Safety Rules

- Keep runtime contract changes out of incidental cleanup.
- Do not move live runtime ownership from `server.js` unless you are deliberately replacing that architecture.
- Do not replace `window.APP`, `window.RSL`, or inline-handler dependencies unless you are migrating the HTML at the same time.
- Do not change `selectServer()` output shape without checking playlist, Xtream, client, and stream routes.
- Treat `channels.json_data` as persisted compatibility state.
- Treat `lines.password_hash`, `password_enc`, and access-token behavior as compatibility-sensitive.
- Do not claim distributed live runtime is complete. It is not.

## Testing Expectations

Current Jest reality:
- Many tests are real route/service contract tests.
- Many frontend and XC-runtime tests are static source assertions.
- Very little proves real FFmpeg, MariaDB, Redis, provisioning, or remote-node behavior end-to-end.

When changing important code:
- run `npm test -- --runInBand`
- prefer adding behavior tests over source-string tests
- be careful with docs-dependent tests in `tests/unit/services/xcRuntimePhase8.test.js`

## What Not To Touch Casually

- access-code gateway behavior in `server.js`
- playback token generation and validation
- `routes/stream.js` redirect flow
- `services/serverService.js` selector order
- `public/js/modules/router.js` page canonicalization
- `public/index.html` page IDs and inline handler wiring
- cron schedules in `lib/crons.js`

## Current Maturity

Strongest areas:
- single-node live runtime
- playlist and Xtream compatibility
- line and reseller CRUD
- content import and catalog breadth
- local backup/restore

Weakest areas:
- distributed live runtime ownership
- security hardening
- honest operational telemetry
- RBAC enforcement
- frontend maintainability
- migration discipline

## Known Weak Areas

- `streamLimiter` exists but is not mounted
- `buildVpnasnMiddleware()` exists but is not mounted
- `multiLoginDetector` is largely in-memory UI support, not a strong enforcement path
- cloud backup provider uploads are intentionally de-scoped
- dashboard truth is partial for some counters and remote node metrics
- local Redis boot failure is not treated as fatal even though runtime features depend on Redis

## Architecture Reference Aliases

Legacy reference aliases used by the repository test suite and older planning notes:

- `LB_SOURCE_ARCHITECTURE_ANALYSIS`: see `docs/ARCHITECTURE_AUDIT.md`
- `LB_TARGET_GAP_ANALYSIS`: see `docs/CURRENT_IMPLEMENTED_STATE.md` and `docs/TECHNICAL_DEBT_AND_RISKS.md`
- `LB_IMPLEMENTATION_PLAN`: see `docs/IMPLEMENTATION_RECOMMENDATIONS.md`

These aliases are historical labels. The current canonical documents are the files above.
