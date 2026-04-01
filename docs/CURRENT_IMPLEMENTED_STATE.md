# Current Implemented State

This file describes what the repository currently implements now, based on code inspection rather than removed documentation.

## Overall State

Current reality:
- `Implemented`: single-node IPTV panel with admin, reseller, line, playlist, Xtream, live restream, VOD, series, backup, and monitoring basics
- `Partial`: distributed selector, failover, proxy-delivery, provisioning, runtime placement/session truth
- `Weak`: RBAC enforcement, security hardening, dashboard truth, maintainability
- `Missing/De-scoped`: cloud backup uploads, full remote live runtime ownership, live proxy delivery

## Phase 1 - Runtime Placement Foundation

`Implemented`:
- `stream_server_placement`
- `line_runtime_sessions`
- `server_commands`
- `server_agent_credentials`
- DB helpers for placements, sessions, command leasing, and credential rotation

`Partial`:
- these foundations exist in schema and helpers
- not every UI/runtime path uses them as a complete source of truth yet

## Phase 2 - Assignment And Selector Contract

`Implemented`:
- `selectServer()` resolution order in `services/serverService.js`
- line override via `force_server_id`
- movie assignment via `movies.stream_server_id`
- live assignment via channel `stream_server_id` stored inside `channels.json_data`
- effective episode inheritance through episode, then series, then default server setting

This part of the codebase is real and reused across playlist, Xtream, client, and stream routes.

## Phase 3 - Command / Control Plane

`Implemented`:
- command queue tables
- command lease flow over `/api/agent/heartbeat`
- command ACK flow over `/api/agent/command/ack`
- executable commands for `reload_proxy_config`, `restart_services`, and `reboot_server`

`Partial`:
- stream lifecycle commands exist in schema/test language but are explicitly rejected as de-scoped in the current TARGET runtime

## Phase 4 - Runtime Readiness Gate

`Implemented`:
- `isRuntimeReady()` checks live placement status, runtime instance id, readiness timestamp, and heartbeat freshness
- live subscriber redirects use this before sending traffic to a remote node

`Missing`:
- remote live start/stop ownership is not implemented end-to-end

The code knows how to ask, "is a remote live runtime already ready?" It does not fully know how to create that state from scratch on a remote node.

## Phase 5 - Remote Movie / Episode Serving

`Implemented`:
- panel-side `/api/stream/node-validate`
- agent-side `/stream/movie/...` and `/stream/episode/...` server
- signed redirect generation from `routes/stream.js`
- remote byte-serving for movie and episode playback

`Risky`:
- behavior is mostly proved by mocked tests and source inspection, not by deep end-to-end runtime testing

## Phase 6 - Explicit Failover And Session Reconciliation

`Implemented`:
- explicit failover relationships via `server_relationships`
- `selectFailoverServer()`
- cron cleanup of stale runtime sessions
- placement-client reconciliation helpers

`Partial`:
- these features are only as truthful as the placement/session data being fed into them

## Phase 7 - origin-proxy Delivery

`Implemented`:
- `origin-proxy` relationships in schema and admin routes
- proxy selection helpers in `services/serverService.js`
- proxy redirect path for movie and episode playback
- agent-side `sync_proxy_upstream` command

`Partial`:
- `origin-proxy` delivery is only used for movie and episode flows
- live proxy delivery is still de-scoped

## Phase 8 - Hardening

`Implemented`:
- credential rotation helpers for agent credentials
- readiness/failover/proxy tests and docs expectations in the test suite

`Partial`:
- hardening is uneven
- session model, CSRF posture, secret storage, rate limiting, and operational truth are still weaker than the UI surface suggests

## Domain Status Matrix

| Domain | State | Notes |
| --- | --- | --- |
| Admin portal | Implemented | broad feature surface |
| Reseller portal | Implemented, smaller | useful but much narrower than admin |
| Client portal | Implemented, basic | isolated inline frontend |
| Live local runtime | Implemented | main working runtime path |
| On-demand live start | Implemented | `lib/on-demand-live.js` |
| Nginx streaming mode | Implemented | HLS on disk, TS via Node pipe |
| VOD / movie playback | Implemented | local proxy and remote node redirect paths |
| Series / episode playback | Implemented | local proxy and remote node redirect paths |
| DRM internal restreams | Implemented | internal `mpegts`-only flow |
| Xtream metadata | Implemented | `player_api.php` and `xmltv.php` |
| M3U playlist generation | Implemented | `get.php` plus per-asset selector resolution |
| Server selection | Implemented | clear fallback order |
| Failover | Partial | relationship-driven, depends on runtime truth |
| Proxy delivery | Partial | movie/episode only |
| Remote live runtime ownership | Missing/De-scoped | most important distributed gap |
| Server provisioning | Partial | operationally real, still brittle |
| Local backups | Implemented | `mysqldump` plus restore |
| Cloud backup uploads | Missing/De-scoped | config only |
| RBAC | Weak | storage/UI exists, enforcement does not match |
| VPN / ASN / multi-login enforcement | Partial to weak | surfaces exist, wiring is incomplete |
| Dashboard websocket | Implemented, partial truth | some metrics are placeholders or undercount |

## Features That Look More Complete Than They Are

- Server Area / LB pages
  - the UI suggests a fuller distributed runtime than the code actually owns
- Cloud backup settings
  - the config surface exists, uploads do not
- RBAC pages
  - roles and permissions are editable, but route-level enforcement is not comprehensive
- Security pages
  - VPN, ASN, and multi-login tools exist, but not all enforcement hooks are active

## Removed Or Explicitly Unavailable In The Current Code

- mass EPG assignment returns `410`
- EPG auto-match returns `410`
- remote live runtime command execution is explicitly de-scoped
- live proxy delivery is explicitly de-scoped
- cloud provider uploads are intentionally de-scoped

## Practical Conclusion

The codebase already contains a large amount of real implementation.

The honest boundary is this:
- the single-node panel is materially real
- the distributed runtime layer is materially partial
