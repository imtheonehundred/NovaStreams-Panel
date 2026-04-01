# Repository Full Audit Report

Audit basis:
- direct code inspection of the current repository
- no reliance on removed docs
- no runtime contract changes
- no feature implementation work

Metrics basis:
- counts exclude `.git` and `node_modules`
- source-like file counts include `js`, `ts`, `tsx`, `jsx`, `html`, `css`, and `sql`

## Executive Summary

`NovaStreams Panel` is a real IPTV operator panel with meaningful production-oriented code, especially on the single-node path.

Most important truths:
- this is not a fake shell project; it has real live runtime, playlist, Xtream, line, reseller, import, and backup code
- the single-node core is much more complete than the multi-node story
- the distributed layer is real in schema, selector logic, heartbeat, and movie/episode delivery, but remote live runtime ownership is still partial
- the project's biggest risks are monolithic control files, security debt, drift between UI claims and runtime truth, and test quality that is stronger on contracts than on real operations

Commercial usability:
- usable today for a technically capable operator in a controlled single-node deployment
- still needs stabilization before it should be trusted as a polished multi-node commercial control plane

## 1. Project Identity

### What This Project Actually Is

This repository is a self-hosted IPTV restream and control panel.

It provides:
- admin control plane
- reseller control plane
- subscriber self-service page
- playlist publishing
- Xtream-compatible metadata publishing
- live source restreaming through FFmpeg
- VOD and series catalog delivery
- partial server-area / load-balancer / proxy / failover support

### Business / Product Purpose

The code is clearly aimed at an IPTV operator who needs to:
- ingest live sources from DASH, HLS, RTMP, SRT, UDP, and direct media URLs
- manage channel, movie, and series inventory
- sell and manage subscriber lines and reseller accounts
- publish playback through M3U, Xtream, and direct playback URLs
- monitor runtime health and subscriber activity

### Topology Classification

Current classification:
- `Single-node`: complete enough to matter and clearly the main working path
- `Hybrid / partially distributed`: yes
- `Fully distributed live runtime`: no

Reason:
- local FFmpeg lifecycle and local stream serving are real
- remote heartbeat, selector, failover, proxy relationships, and remote movie/episode serving are real
- remote live runtime start/stop/reconcile behavior is still explicitly de-scoped

### What Is Mature

- local live restream runtime
- playlist generation
- Xtream metadata compatibility
- line and reseller CRUD
- content import breadth
- local backup and restore

### What Is Still Incomplete

- distributed live runtime ownership
- security hardening
- operational truthfulness in dashboards
- RBAC enforcement
- frontend maintainability
- migration discipline

## 2. Architecture From A To Z

### Entrypoints

| Entrypoint | Responsibility |
| --- | --- |
| `server.js` | main application orchestrator |
| `agent/index.js` | remote node heartbeat and movie/episode byte-serving |
| `public/index.html` | admin shell |
| `public/reseller.html` | reseller shell |
| `public/client.html` | client shell |

### Request Flow

#### Admin Flow

1. `server.js` validates an admin access code and serves `public/index.html`.
2. `/api/auth/login` authenticates a panel user but also checks that the login happens inside a valid gateway session.
3. Authenticated admin requests go mostly to `/api/admin/*`, plus `/api/channels/*`, `/api/dashboard/*`, and selected inline `/api/*` routes.

#### Reseller Flow

1. `server.js` validates a reseller access code and serves `public/reseller.html`.
2. `/api/auth/login` checks both credentials and reseller portal role.
3. The reseller shell uses `/api/reseller/*` for lines, profile, credits, packages, and bouquets.

#### Client / Subscriber Flow

1. The subscriber opens `public/client.html` directly.
2. `/api/client/login` authenticates against the `lines` model.
3. `/api/client/*` exposes account details, connection history, playlist export, EPG export, and password changes.

#### Playlist / Xtream / Public Playback Flow

1. `/get.php` authenticates line credentials and generates a playlist.
2. `/player_api.php` authenticates the same line model and returns Xtream-compatible metadata.
3. `/xmltv.php` returns XMLTV filtered by the line's bouquet access.
4. `/live`, `/movie`, and `/series` are the real subscriber playback routes.

### Route Ownership

Primary route files:
- `routes/admin.js`
- `routes/reseller.js`
- `routes/client.js`
- `routes/stream.js`
- `routes/playlist.js`
- `routes/xtream.js`
- `routes/channels.js`
- `routes/drm.js`
- `routes/transcode.js`
- `routes/playback.js`
- `routes/dashboard.js`
- `routes/system.js`
- `routes/agent.js`

### Service Ownership

Most important services:
- `services/lineService.js`
- `services/serverService.js`
- `services/securityService.js`
- `services/playlistService.js`
- `services/xtreamService.js`
- `services/importService.js`
- `services/provisionService.js`
- `services/backupService.js`
- `services/wsServer.js`

### What Still Lives In `server.js`

`server.js` still owns too much:
- access-code gateway routing
- auth helper middleware
- HLS and MPEG-TS serving
- local FFmpeg runtime engine
- some CRUD and tooling endpoints
- boot and shutdown orchestration

This is the most important architectural fact in the repo.

### Runtime State Flow

State layers:
- persisted channel definitions in `channels.json_data`
- in-memory runtime maps in `lib/state.js`
- Redis live connection and cache state
- DB placement and session truth tables for partial distributed runtime state

### DB Usage

MariaDB is the primary store for:
- users, resellers, lines
- channels, movies, series, episodes
- settings
- server registry and runtime tables
- QoE, health, logs, backups, Plex, RBAC

### Redis Usage

Redis is used for:
- line live-connection TTL keys
- account-sharing history and pub/sub alerts
- cache middleware entries
- bandwidth and health history

### Filesystem Usage

Filesystem directories with operational meaning:
- `streams/`
- `logs/`
- `watermarks/`
- `data/backups/`
- `iptv-media/hls` in nginx mode
- `data/user_meta.json`

### Agent / Node / LB / Server Area Behavior

Implemented:
- server registry and domain records
- node heartbeat and capability reporting
- proxy and failover relationships
- provisioning scripts
- remote movie/episode serving

Partial:
- remote live runtime ownership
- command plane breadth
- honest runtime reconciliation across nodes

### WebSocket / Dashboard Flow

The websocket server:
- parses the cookie-session cookie
- authenticates websocket clients
- emits dashboard snapshots every 5 seconds
- forwards eventBus notifications

Truthfulness is mixed:
- local system metrics are real
- some remote metrics are real when heartbeats arrive
- some viewer and connection stats are placeholders or undercounted

## 3. Frontend Analysis

### Admin Frontend Structure

Admin frontend structure is a large no-framework SPA shell:
- one HTML shell: `public/index.html`
- one large controller: `public/js/app.js`
- a growing set of domain modules under `public/js/modules/`

### Routing Model

Routing is a fragile multi-layer system:
- `server.js` decides which shell can load on which path
- `public/js/modules/router.js` normalizes admin page routes and aliases
- `public/js/app.js` switches hidden page sections
- `public/index.html` page IDs must match the route keys

### State Model

State is not centralized. Most of it is mutable closure state in `public/js/app.js`.

### `app.js` Role

`app.js` is still the real admin application kernel.

It owns:
- auth bootstrap
- navigation
- page switching
- module wiring
- compatibility exports
- a large amount of business UI logic that has not been extracted yet

### `window.APP` Compatibility

Yes, still present and still required.

This is not legacy decoration. Inline handlers depend on it across the admin shell and generated row markup.

### Inline `onclick` Behavior

Still heavily used in:
- `public/index.html`
- `public/js/app.js`
- `public/reseller.html`
- `public/client.html`

### Strong Frontend Areas

- dashboard
- lines page
- server area pages

### Weak Frontend Areas

- movies/series/episodes pages still rely heavily on `app.js`
- settings and security pages mix real and parity-only functionality
- client portal is isolated and basic
- reseller portal is functional but narrower and less mature

### Fragile UI Parts

- route alias synchronization
- global export dependency
- giant hidden-section admin shell
- CSS override layering

## 4. Backend Analysis

### Main Backend Entrypoint

`server.js` is the primary backend entrypoint and runtime authority.

### Route Ownership

Cleanest route/service separations:
- playlist generation
- Xtream metadata
- line access logic
- server selection logic

Most monolithic route owner:
- `routes/admin.js`

### Service Ownership

Backend separations are best where the repo has service-style builders.

The worst ownership overlap is stream lifecycle control, because both `server.js` and `services/streamManager.js` own versions of that story.

### Cleanly Separated Areas

- `playlistService`
- `xtreamService`
- `lineService`
- `serverService`

### Monolithic Areas

- `server.js`
- `routes/admin.js`
- `lib/db.js`

### Strongest Backend Areas

- playlist and Xtream compatibility
- line auth and subscriber route contracts
- server selector logic

### Weakest Backend Areas

- distributed live orchestration
- ops truthfulness
- secret management
- DB migration discipline

## 5. Streaming / IPTV Runtime Analysis

### How Live Streams Are Created, Started, Stopped, Restarted

Normal live channels:
- created through `/api/channels`
- stored in `channels.json_data`
- loaded into the in-memory `channels` map at boot
- started/stopped by `server.js` `startChannel()` and `stopChannel()`

On-demand live:
- lazy-started by `lib/on-demand-live.js`
- stopped by idle-kill logic when viewers disappear

### How Playback URLs Are Generated

Admin/API playback:
- `routes/channels.js` builds signed preview URLs
- `routes/playback.js` builds API playback URLs using a separate token/session path

Subscriber playback:
- playlists and Xtream metadata emit `/live`, `/movie`, `/series` URLs
- those routes authenticate lines, then redirect or proxy as needed

### How `/live/*` Works

There are two relevant live URL layers:

Subscriber-facing:
- `/live/:username/:password/:file` in `routes/stream.js`

Local byte-serving:
- `/live/:channelId.ts` in `server.js`

Subscriber flow:
- authenticate line
- enforce IP, UA, geo, bouquet, output, and connection limits
- select origin server
- verify runtime readiness for remote live
- optionally use explicit failover
- redirect to remote or panel-local HLS/TS URL with signing

### How `/movie/*` Works

- authenticate line
- check bouquet access
- select server
- if remote node selected, redirect to agent `/stream/movie/...`
- if proxy relationship exists, redirect to proxy node instead of origin node
- otherwise panel proxies the source URL directly

### How `/series/*` Works

Same pattern as movies, but using episode IDs.

### How `/get.php` Works

- line auth
- playlist build through `services/playlistService.js`
- per-asset base URLs resolved through `serverService.selectServer()` and base URL helpers

### How `player_api.php` / Xtream Compatibility Works

`routes/xtream.js` authenticates the line and uses `xtreamService` to return:
- user info
- live categories and streams
- VOD categories and streams
- series categories and series info
- short EPG

Xtream metadata is real, but actual media transport still goes through `/live`, `/movie`, and `/series`.

### How Stream Runtime Sessions Are Tracked

Ephemeral live-connection state:
- Redis keys in `lineService`

Distributed/runtime session state:
- `line_runtime_sessions`

Current limitation:
- not every local playback path writes the same truth into `line_runtime_sessions`

### How Proxy / Redirect / Local Serving Works

Local panel serving:
- HLS files under `streams/`
- MPEG-TS over stdout pipe and `PassThrough`

Remote serving:
- movie/episode redirect to node agent
- live redirect only when runtime placement is already ready

Proxy serving:
- movie/episode origin-proxy chain only

### Selector / Server Assignment / LB Logic

`selectServer()` order:
1. `force_server_id`
2. content-level assignment
3. `default_stream_server_id`
4. first enabled server ordered by role and sort order
5. panel settings fallback

### Runtime Truth Vs Implementation

`True working pieces`:
- local FFmpeg runtime
- local HLS/TS delivery
- remote movie/episode delivery
- selector and failover decision logic

`Partial pieces`:
- placement truth
- runtime session truth
- live failover usefulness in real deployments
- proxy delivery breadth

`Risky pieces`:
- remote live orchestration claims
- dashboard counters based on partial truth
- duplicate stream engine ownership

## 6. Database / Persistence Analysis

### Schema Size

- total tables in `scripts/schema.sql`: `48`

### Main Entities

Core groups:
- users and portal auth
- lines and subscriber access
- content catalog
- server/runtime infrastructure
- security and monitoring tables

### Data Storage Style

Relational plus blob-heavy.

The biggest blob dependency is `channels.json_data`.

### Migrations

Formal migrations are not the main evolution mechanism.

Current evolution style is ad hoc:
- schema file
- bootstrap script
- runtime `ensure*()` and `ALTER TABLE` logic in `lib/db.js`

### Production-Safety Assessment

Database design is usable, but not cleanly production-safe in its current discipline.

Biggest issues:
- JSON blob persistence for channels
- drift between schema artifacts and runtime ensures
- secret/plaintext columns

### Risky Persistence Patterns

- reversible line password storage alongside hashes
- plaintext service credentials in DB settings or tables
- file-backed user metadata outside MariaDB

## 7. Auth / Security Analysis

### Admin Auth

Admin auth requires:
- panel user session
- valid admin access code context
- `dbApi.isAdmin(userId)`

### Reseller Auth

Reseller auth requires:
- panel user session
- valid reseller access code context
- `dbApi.isReseller(userId)`

### Subscriber / Client Auth

Subscriber auth uses:
- line username and password for playlist/Xtream/playback routes
- bearer `access_token` for `/api/client`
- line session for the client portal

### Session Model

Panel session model:
- `cookie-session`
- signed cookie, not server-stored session data

API playback session model:
- in-memory tokens in `services/sessionService.js`

### Access-Code / Portal Binding Model

This is a real control boundary for admin/reseller portals.

Login without the gateway context is intentionally rejected.

### Rate Limiting

Real:
- auth limiter is mounted
- admin API limiter is mounted

Weak:
- stream limiter exists but is not mounted anywhere
- rate limit storage is in-memory, not distributed

### Security Headers

Real:
- helmet is mounted

Weak:
- CSP disabled
- HSTS disabled by default
- permissive cross-origin settings remain for compatibility

### Biggest Security Risks

- no CSRF layer for cookie-authenticated panel routes
- plaintext secrets in config and DB-backed settings
- weak operational secret hygiene
- unmounted stream rate limiter
- RBAC surface exceeds actual enforcement

### Fake Security Vs Real Security

Real:
- signed playback URLs
- access-code gateway model
- bcrypt-backed line password verification

More cosmetic or partial:
- RBAC pages
- VPN/ASN/multilogin controls
- some dashboard security indicators

### Production Safety Verdict

The panel is not yet security-hardened enough to call production-safe without caveats.

It can be operated carefully, but it still needs deliberate hardening work.

## 8. Monitoring / Backup / Operations Analysis

### Health Monitoring

Exists:
- `services/healthMonitor.js`
- websocket dashboard health surface

Risk:
- internal health check targets `/api/admin/health-check` without admin auth context

### Bandwidth Monitoring

Exists:
- Redis-backed bandwidth history
- websocket live snapshot

### Dashboard Truthfulness

Partially truthful:
- some metrics are measured
- some are placeholders
- some subscriber/runtime views undercount local paths

### Backup Model

Real path:
- local `mysqldump` backup
- gzip compression
- DB record in `backups`

### Restore Model

Real path:
- requires filename confirmation
- creates a safety backup before restore
- restores through `mysql`

### Cloud Backup Reality

Current reality:
- config surface exists
- provider uploads are intentionally unsupported

### Biggest Ops Risks

- partial dashboard truth
- Redis failure handling is too soft
- provisioning is operationally brittle
- backup settings surface is broader than actual supported backup modes

## 9. Tests Analysis

### Totals

- test files: `42`
- current Jest suite after doc rebuild: expected to pass once docs exist and match the test suite's load-bearing docs assertions

Actual pre-doc run result during this audit:
- `40` passing suites
- `1` failing suite
- `405 / 408` passing tests
- failures were only missing `CLAUDE.md` and `docs/CURRENT_IMPLEMENTED_STATE.md`

### What Is Actually Covered

Better-covered areas:
- auth and client route contracts
- backup route/service behavior
- line password migration
- selector/failover contract logic
- playlist/Xtream/server-service contract surfaces

### What Is Mostly Static / Structural

Weak test style appears in many files that:
- read source files as strings
- assert that functions, sections, or phrases exist
- do not execute the real behavior they describe

### Confidence Level Of The Test Suite

The suite deserves moderate confidence for contract drift detection and low-to-moderate confidence for real runtime safety.

It is not strong enough to certify FFmpeg, Redis, MariaDB, provisioning, or multi-node behavior end-to-end.

### Biggest Missing Tests

- real FFmpeg startup and output smoke tests
- live MariaDB plus Redis integration tests
- remote agent movie/episode delivery integration tests
- provisioning dry-run / failure-mode tests
- honest operational telemetry tests

## 10. Missing Areas / Weak Areas / Panel Deficiencies

### What Is Still Missing

- full remote live orchestration
- true cloud backup execution
- true RBAC enforcement
- EPG mass assignment and auto-match

### What Looks Complete But Is Not Safe

- server-area distributed runtime story
- security surfaces for VPN/ASN/multilogin
- dashboard viewer truth
- roles and permissions management

### What Keeps The Panel Below A Polished Commercial System

- oversized monolith files
- partial distributed runtime ownership
- security debt
- mixed truth models for telemetry
- ad hoc migrations
- limited end-to-end testing

## Panel Gaps / What Is Missing In The Panel

### Missing Admin Features

- real EPG mass assignment
- real EPG auto-match
- enforceable RBAC instead of mostly editable RBAC metadata
- real cloud backup uploads
- a true remote-live orchestration UI backed by working commands

### Weak Workflows

- server provisioning and first-heartbeat verification
- backup configuration versus actual supported backup modes
- security configuration versus actual enforcement depth
- server monitoring versus real runtime authority

### Weak Pages

- settings page because it mixes real, parity, and de-scoped surfaces
- security page because enforcement is patchy behind the UI
- legacy content management sections still tied to `app.js`
- client portal because it is inline and isolated
- reseller portal because it is smaller and less mature

### Missing Runtime Behaviors

- remote live start/stop orchestration
- live proxy delivery
- complete unified runtime session truth across local and remote playback
- honest viewer counters wired into channel state

### Missing Safety / Validation

- CSRF protection
- mounted stream rate limiting
- stronger secret handling and credential storage
- restore verification and preflight checks
- cluster-safe session/token state for API playback

### Missing Testing

- FFmpeg integration tests
- MariaDB plus Redis behavior tests
- remote agent streaming tests in a live environment
- provisioning failure-mode tests
- telemetry truth tests

### Missing UX / Operational Polish

- unified routing model across all shells
- removal of inline global-handler fragility
- clearer labeling of de-scoped features in the UI
- dashboards that clearly separate measured data from placeholders

## 11. Size / Inventory Metrics

Measured repository metrics:

- total files: `236`
- source-like files: `161`
- total approximate source-like lines: `59,216`

Line counts by category:

| Category | Files | Approx Lines |
| --- | ---: | ---: |
| Backend JS/TS | 93 | 25,776 |
| Frontend JS/TS | 18 | 13,293 |
| HTML | 3 | 4,584 |
| CSS | 2 | 8,108 |
| SQL | 3 | 1,053 |
| Tests | 42 | 6,402 |

Top 20 largest source-like files:

| Rank | File | Lines |
| --- | --- | ---: |
| 1 | `public/js/app.js` | 9,610 |
| 2 | `public/css/premium.css` | 7,260 |
| 3 | `public/index.html` | 4,037 |
| 4 | `lib/db.js` | 3,219 |
| 5 | `server.js` | 3,166 |
| 6 | `routes/admin.js` | 2,926 |
| 7 | `services/serverService.js` | 1,037 |
| 8 | `scripts/schema.sql` | 924 |
| 9 | `services/provisionService.js` | 888 |
| 10 | `public/css/style.css` | 848 |
| 11 | `lib/ffmpeg-args.js` | 786 |
| 12 | `services/importService.js` | 710 |
| 13 | `tests/unit/services/xcRuntimePhase1.test.js` | 675 |
| 14 | `tests/unit/services/assignmentContract.test.js` | 671 |
| 15 | `routes/stream.js` | 654 |
| 16 | `routes/channels.js` | 627 |
| 17 | `public/js/modules/dashboard.js` | 593 |
| 18 | `public/js/reseller-app.js` | 521 |
| 19 | `services/wsServer.js` | 464 |
| 20 | `public/js/modules/lines.js` | 453 |

Top 10 riskiest files:

| File | Why |
| --- | --- |
| `server.js` | runtime, auth gateway, and boot lifecycle all converge here |
| `routes/admin.js` | huge admin blast radius |
| `lib/db.js` | giant DAO and schema-evolution hub |
| `public/js/app.js` | main admin monolith |
| `public/index.html` | shell coupling and inline handlers |
| `services/serverService.js` | selector, failover, proxy correctness |
| `routes/stream.js` | public playback auth and redirect correctness |
| `lib/ffmpeg-args.js` | output behavior matrix |
| `services/importService.js` | import complexity and side effects |
| `services/provisionService.js` | remote SSH and system mutation |

## 12. Completion And Confidence

Realistic percentages:

| Area | Percentage | Why |
| --- | ---: | --- |
| Overall completion | 73% | broad product surface exists, but distributed runtime and hardening are incomplete |
| Production confidence | 56% | single-node path is usable; ops and security debt still matter |
| Frontend completion | 70% | many pages exist, architecture quality lags behind surface area |
| Backend completion | 78% | broad domain coverage, but monolith and distributed gaps remain |
| Runtime / streaming completion | 68% | strong local runtime, partial distributed runtime |
| Security confidence | 41% | real signing/auth exists, hardening is still weak |
| Test confidence | 58% | good contract coverage, weak real-runtime coverage |
| Panel maturity | 67% | strong beta on single-node, partial on distributed mode |

## 13. Final Technical Verdict

### How Strong Is This Project Really

Stronger than a typical unfinished open-source panel clone.

The codebase already contains:
- real local streaming runtime
- real subscriber line model
- real playlist and Xtream compatibility
- real reseller and admin CRUD
- real import, backup, and websocket systems

### Is It Commercially Usable Already

Yes, with qualifications.

Best answer:
- commercially usable for controlled single-node operation with an operator who understands the gaps
- not yet trustworthy as a fully hardened, fully honest, fully distributed commercial system

### Biggest Truths About The Codebase

1. The single-node path is the real product.
2. The distributed layer is meaningful but partial.
3. The UI surface is ahead of some operational/security realities.
4. The highest structural risk is concentrated in a few giant files.

### What Should Be Improved Next

1. Finish or narrow the distributed live-runtime story.
2. Harden security and secret handling.
3. Make monitoring truth match real runtime behavior.
4. Reduce monolith risk in `server.js`, `routes/admin.js`, and `public/js/app.js`.
5. Upgrade tests from structural checks to real behavior checks.

### Bottom-Line Verdict

This is a serious IPTV panel codebase with real product weight.

It already works in important ways.

It still needs stabilization more than it needs more breadth.

Adding major new features before addressing runtime truth, security, ops honesty, and monolith debt would be the wrong priority.

## Related Audit Docs

- `docs/ARCHITECTURE_AUDIT.md`
- `docs/BACKEND_MAP.md`
- `docs/FRONTEND_MAP.md`
- `docs/DATABASE_MAP.md`
- `docs/CURRENT_IMPLEMENTED_STATE.md`
- `docs/TECHNICAL_DEBT_AND_RISKS.md`
- `docs/FEATURE_MATRIX.md`
- `docs/IMPLEMENTATION_RECOMMENDATIONS.md`
