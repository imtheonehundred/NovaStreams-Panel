# Architecture Audit

## Identity

`NovaStreams Panel` is a real IPTV operator panel, not a placeholder admin dashboard.

Current codebase scope:
- live source ingest and restreaming
- VOD and series catalog management
- reseller and line management
- Xtream-compatible metadata endpoints
- playlist generation
- real-time dashboarding
- server registry, heartbeat, failover, proxy relationships, and provisioning

Current topology classification:
- `Implemented`: single-node live runtime on the panel host
- `Implemented`: remote agent heartbeat and remote movie/episode byte-serving
- `Partial`: server selector, failover, proxy relationships, runtime placement schema
- `Missing/De-scoped`: full remote live runtime orchestration

The project is best described as a hybrid control plane with a mature local runtime and a partial distributed runtime layer.

## Entrypoints

| Entrypoint | Role |
| --- | --- |
| `server.js` | Express app, gateway routing, auth/session, local stream runtime, boot lifecycle |
| `agent/index.js` | Remote node heartbeat, command ACK, movie/episode byte-serving |
| `public/index.html` | Admin shell |
| `public/reseller.html` | Reseller shell |
| `public/client.html` | Client self-service shell |

## End-To-End Flow

### Admin Flow

1. Browser opens `/admin` or `/:accessCode`.
2. `server.js` validates the access code and sends `public/index.html` for admin codes.
3. Login posts to `/api/auth/login`.
4. Session is bound to both `userId` and access-code gateway context.
5. Admin UI calls `/api/admin/*`, `/api/channels/*`, `/api/dashboard/*`, `/api/drm-restreams`, and selected inline `/api/*` routes.
6. Backend reads or mutates MariaDB, runtime maps, Redis, filesystem state, or both.

### Reseller Flow

1. Browser opens `/:accessCode` for a reseller access code.
2. `server.js` sends `public/reseller.html`.
3. Login still uses `/api/auth/login`, but `routes/auth.js` checks that the authenticated user role matches the reseller portal role.
4. Reseller UI calls `/api/reseller/*` for lines, credits, packages, bouquets, and profile data.

### Client / Subscriber Flow

1. Browser can open `public/client.html` directly.
2. Login posts to `/api/client/login` using line credentials.
3. Client session stores `lineId`, `lineUsername`, and `portalRole=user`.
4. Client shell uses `/api/client/me`, `/connections`, `/playlist`, `/epg`, and `/password`.

### Playlist / Xtream Flow

1. `/get.php` authenticates a line via `lineService.authenticateLine()`.
2. `playlistService.generatePlaylist()` builds live, movie, and series URLs.
3. For each asset, `serverService.selectServer()` may choose a public base URL.
4. `player_api.php` and `xmltv.php` authenticate the same line model and delegate to `xtreamService` or `epgService`.

### Live Playback Flow

1. Client hits `/live/:username/:password/:file`.
2. `routes/stream.js` authenticates the line, checks expiry, geo, IP, UA, bouquet, output permissions, and connection count.
3. `serverService.selectServer()` chooses an origin candidate.
4. `serverService.isRuntimeReady()` gates remote live redirects.
5. If the selected origin is not ready, `selectFailoverServer()` may pick an explicit failover.
6. If no remote runtime is ready, the route falls back to panel-local delivery when the local FFmpeg process is already running.
7. Redirect target is a signed HLS or MPEG-TS URL on the remote node or panel.
8. Local bytes are ultimately served by `server.js` through `/streams/*` or `/live/:id.ts`.

Important truth:
- distributed live routing is readiness-aware
- distributed live orchestration is not complete

### Movie / Series Playback Flow

1. Client hits `/movie/:username/:password/:id.ext` or `/series/:username/:password/:id.ext`.
2. `routes/stream.js` authenticates the line and checks bouquet membership.
3. `serverService.selectServer()` chooses an origin.
4. If a remote node with `publicBaseUrl` exists, the panel redirects to `/stream/movie/...` or `/stream/episode/...` on that node.
5. The remote agent validates the signed request against `/api/stream/node-validate`.
6. The agent fetches the original source URL and pipes the bytes back to the client.
7. If no remote node is selected, the panel locally proxies the source URL with `fetch()`.

### Proxy Delivery Flow

`origin-proxy` relationships are implemented for movie and episode delivery only.

When a proxy relationship exists:
- the panel selects an origin server
- `serverService.selectProxyServer()` may choose a proxy server for that origin
- the client is redirected to the proxy node instead of the origin node

Current limitation:
- live proxy delivery is explicitly de-scoped in the current code

## Runtime State Flow

Authoritative runtime layers:
- MariaDB `channels.json_data`: persisted channel definition
- `lib/state.js`: in-memory `channels`, `processes`, `tsBroadcasts`, and user activity maps
- Redis: line live-connection keys, sharing detector, cache entries, bandwidth history, health history
- `stream_server_placement`: partial distributed runtime placement truth
- `line_runtime_sessions`: partial active session truth, mainly for remote-serving paths

Important mismatch:
- many admin dashboards query `line_runtime_sessions`
- panel-local playback paths do not always write the same truth
- some dashboards are therefore directionally useful, not canonical for every playback path

## Database, Redis, And Filesystem Roles

MariaDB:
- long-lived application state
- content catalog
- lines/users/groups
- settings
- server registry and runtime tables

Redis:
- live line connection tracking
- account-sharing history and alerts
- cache middleware entries
- bandwidth and health archives

Filesystem:
- `streams/`: local HLS output and per-channel working dirs
- `logs/`: FFmpeg logs
- `watermarks/`: uploaded watermark images
- `data/backups/`: local backup store
- `iptv-media/hls` when `STREAMING_MODE=nginx`

## WebSocket And Dashboard Flow

`services/wsServer.js` does three things:
- authenticates websocket connections using the same session cookie
- broadcasts periodic dashboard snapshots every 5 seconds
- forwards stream/sharing events from `eventBus`

The dashboard is real-time, but not all fields are equally trustworthy:
- local CPU/RAM/network are real
- remote heartbeat data is real when agents report
- some remote-card facts are placeholders
- local viewer totals often stay at zero because `channel.viewers` is not actively maintained

## Architecture Assessment

| Area | State | Notes |
| --- | --- | --- |
| Local live runtime | Implemented | `server.js` owns FFmpeg lifecycle, HLS/TS serving, retries, idle kill |
| Playlist generation | Implemented | `routes/playlist.js` + `services/playlistService.js` |
| Xtream metadata | Implemented | `routes/xtream.js` + `services/xtreamService.js` |
| Remote movie/episode delivery | Implemented, lightly proven | panel redirect plus agent byte-serving |
| Remote live routing | Partial | selector and readiness gates exist; remote live start/stop is de-scoped |
| Failover | Partial | explicit relationship-based failover exists, depends on placement truth being populated |
| Proxy delivery | Partial | movie/episode only; live de-scoped |
| Server provisioning | Partial | SSH install flow exists but is operationally brittle |
| Cloud backup | Missing/De-scoped | config UI exists, provider uploads do not |
| RBAC | Weak | tables and UI exist, enforcement does not match the surface area |

## Main Architectural Truth

The panel is already a substantial IPTV system, but the trustworthy center of gravity is still the single-node runtime in `server.js`.

The distributed layer is real enough to matter, but not complete enough to be treated as fully finished infrastructure.
