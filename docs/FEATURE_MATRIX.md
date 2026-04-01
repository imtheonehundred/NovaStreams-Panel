# Feature Matrix

States used here:
- `Implemented`
- `Partial`
- `Weak`
- `Missing`
- `De-scoped`

| Capability | State | Evidence | Notes |
| --- | --- | --- | --- |
| Access-code admin gateway | Implemented | `server.js` | `/admin` and `/:accessCode` resolve shell access |
| Access-code reseller gateway | Implemented | `server.js` | reseller shell is gateway-bound |
| Admin auth | Implemented | `routes/auth.js`, `server.js` | session plus gateway role validation |
| Reseller auth | Implemented | `routes/auth.js`, `routes/reseller.js` | portal role must match reseller gateway |
| Subscriber client portal | Implemented | `public/client.html`, `routes/client.js` | basic but separate stack |
| M3U playlist generation | Implemented | `routes/playlist.js`, `services/playlistService.js` | `get.php` contract exists |
| Xtream `player_api.php` | Implemented | `routes/xtream.js`, `services/xtreamService.js` | metadata compatibility is real |
| Xtream `xmltv.php` | Implemented | `routes/xtream.js`, `services/epgService.js` | XMLTV render exists |
| Local live HLS restream | Implemented | `server.js`, `lib/ffmpeg-args.js` | panel-local runtime is strongest path |
| Local MPEG-TS pipe delivery | Implemented | `server.js` | TS fan-out uses stdout plus `PassThrough` consumers |
| On-demand live start | Implemented | `lib/on-demand-live.js` | deduplicated lazy-start path |
| On-demand idle kill | Implemented | `server.js`, `lib/hlsIdle.js` | 30s idle stop logic |
| Multi-bitrate HLS | Implemented | `lib/ffmpeg-args.js` | HLS only, not MPEG-TS |
| Watermark overlay | Implemented | `server.js`, `lib/ffmpeg-args.js` | requires transcode |
| Nginx streaming mode | Implemented | `server.js`, `lib/ffmpeg-args.js` | HLS on disk, TS via pipe |
| DRM internal restreams | Implemented | `routes/drm.js` | internal `mpegts` flow |
| Movie playback | Implemented | `routes/stream.js` | local proxy or remote node |
| Series playback | Implemented | `routes/stream.js` | local proxy or remote node |
| Remote movie/episode node serving | Implemented | `routes/stream.js`, `agent/index.js` | validated by panel, served by agent |
| Live server selector | Implemented | `services/serverService.js`, `routes/stream.js` | real fallback order |
| Runtime readiness gate for live | Implemented | `services/serverService.js` | remote live redirect blocked if not ready |
| Explicit failover | Partial | `services/serverService.js` | only as good as placement truth |
| `origin-proxy` delivery | Partial | `services/serverService.js`, `routes/stream.js` | movie/episode only |
| Live proxy delivery | De-scoped | `routes/stream.js` comments and behavior | not active in current TARGET |
| Remote live start/stop orchestration | De-scoped | `services/streamManager.js` | explicit de-scoped returns |
| Server heartbeat and capability reporting | Implemented | `routes/agent.js`, `agent/index.js` | live node telemetry exists |
| Provisioning over SSH | Partial | `services/provisionService.js` | real scripts, brittle ops surface |
| Local backups | Implemented | `services/backupService.js` | create, list, download, restore |
| Cloud backup uploads | De-scoped | `services/cloudBackup.js` | config only |
| RBAC storage and UI | Partial | `scripts/schema.sql`, `routes/admin.js` | data model exists |
| RBAC enforcement | Weak | repo-wide | admin/reseller booleans still dominate |
| VPN detection | Partial | `services/vpnDetector.js`, `routes/admin.js` | settings/logging exist, global enforcement incomplete |
| ASN blocking | Partial | `services/asnBlocker.js`, `routes/admin.js` | helpers exist, not globally enforced |
| Multi-login detection | Weak | `services/multiLoginDetector.js` | mostly in-memory and not deeply wired |
| Account sharing detection | Implemented | `services/sharingDetector.js` | Redis-backed and websocket-published |
| WebSocket dashboard | Implemented | `services/wsServer.js` | real transport, mixed metric quality |
| Health monitoring | Partial | `services/healthMonitor.js` | likely auth mismatch on internal check |
| Telegram bot | Implemented, optional | `services/telegramBot.js` | real bot, operationally simple |
| Plex integration | Partial | `routes/admin.js` | basic storage and simple library/watch fetch |
| EPG mass assignment | Missing | `routes/admin.js` | returns `410` |
| EPG auto-match | Missing | `routes/admin.js` | returns `410` |
| Stream rate limiting | Weak | `middleware/rateLimiter.js` | defined but not mounted |

## Matrix Conclusion

The project already covers most of the advertised surface area.

The weak spots are not empty categories. They are categories where the implementation exists only halfway between schema/UI and true runtime ownership.
