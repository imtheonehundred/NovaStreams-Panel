# API Reference

All API routes are JSON in / JSON out unless noted. Admin routes require a valid session obtained via login. Mutating routes require the `X-CSRF-Token` header.

---

## Authentication

### Get CSRF Token
```
GET /api/auth/csrf-token
Requires: gateway session (must have visited /:accessCode first)
Response: { csrfToken: "string" }
```

### Login
```
POST /api/auth/login
Headers: X-CSRF-Token
Body: { username: string, password: string }
Response: { success: true, user: { id, username, role } }
Errors: 401 invalid credentials | 403 role mismatch | 429 rate limited
```

### Logout
```
POST /api/auth/logout
Headers: X-CSRF-Token
Response: { success: true }
```

### Current User
```
GET /api/auth/me
Response: { id, username, role, accessCode }
Errors: 401 not authenticated
```

### API Keys
```
GET    /api/auth/api-keys          List API keys (shows prefix, not full key)
POST   /api/auth/api-keys          Create key — returns full key ONCE
DELETE /api/auth/api-keys/:id      Revoke key
Headers: X-CSRF-Token (POST/DELETE)
```

---

## Xtream-Compatible API

Authentication for all Xtream endpoints: `?username=LINE_USER&password=LINE_PASS`

### Player API
```
GET  /player_api.php?username=&password=&action=ACTION
POST /player_api.php  (body: username, password, action)

Actions:
  get_live_categories   → [{category_id, category_name, parent_id}]
  get_live_streams      → [{num, name, stream_id, stream_icon, ...}]
  get_vod_categories    → [{category_id, category_name}]
  get_vod_streams       → [{num, name, stream_id, ...}]
  get_vod_info          → {info: {...}, movie_data: {...}}
  get_series_categories → [{category_id, category_name}]
  get_series            → [{series_id, name, cover, ...}]
  get_series_info       → {info: {...}, episodes: {...}}
  get_short_epg         → {epg_listings: [...]}
  get_live_info         → {info: {...}}
```

### Playlist
```
GET /get.php?username=&password=&type=m3u_plus
Response: M3U playlist (text/plain)
```

### XMLTV
```
GET /xmltv.php?username=&password=
Response: XMLTV EPG (application/xml)
```

### Stream URLs
```
Live:   /live/:username/:password/:streamId.ts
VOD:    /movie/:username/:password/:streamId.:ext
Series: /series/:username/:password/:streamId.:ext
HLS:    /hls/:channelId/:token/index.m3u8   (nginx mode)
```

---

## Admin API

All admin routes require `requireAdminAuth` (admin session) + `X-CSRF-Token` (mutating).
Base path: `/api/admin`

### Lines (Subscribers)
```
GET    /lines              List lines (supports pagination, search)
GET    /lines/:id          Get single line
POST   /lines              Create line
PUT    /lines/:id          Update line
DELETE /lines/:id          Delete line
GET    /lines/:id/activity View line activity
POST   /lines/:id/reset    Reset line connection count
```

### Channels
```
GET    /channels           List channels
GET    /channels/:id       Get channel config
POST   /channels           Create channel
PUT    /channels/:id       Update channel
DELETE /channels/:id       Delete channel
POST   /channels/:id/start Start stream
POST   /channels/:id/stop  Stop stream
POST   /channels/:id/restart Restart stream
```

### Movies
```
GET    /movies             List movies (pagination, category filter)
GET    /movies/:id         Get movie detail
POST   /movies             Create movie
PUT    /movies/:id         Update movie
DELETE /movies/:id         Delete movie
```

### Series & Episodes
```
GET    /series             List series
GET    /series/:id         Get series with episodes
POST   /series             Create series
PUT    /series/:id         Update series
DELETE /series/:id         Delete series
GET    /episodes           List episodes
POST   /episodes           Create episode
PUT    /episodes/:id       Update episode
DELETE /episodes/:id       Delete episode
```

### Bouquets
```
GET    /bouquets           List bouquets
POST   /bouquets           Create bouquet
PUT    /bouquets/:id       Update bouquet (channels, movies, series)
DELETE /bouquets/:id       Delete bouquet
POST   /bouquet-sync/sync  Sync bouquet from upstream provider
```

### Categories
```
GET    /categories         List categories by type (live/vod/series)
POST   /categories         Create category
PUT    /categories/:id     Update category
DELETE /categories/:id     Delete category
```

### Packages
```
GET    /packages           List packages
POST   /packages           Create package
PUT    /packages/:id       Update package
DELETE /packages/:id       Delete package
```

### Resellers
```
GET    /resellers          List resellers
GET    /resellers/:id      Get reseller detail (credit balance, lines)
POST   /resellers          Create reseller
PUT    /resellers/:id      Update reseller
DELETE /resellers/:id      Delete reseller
POST   /resellers/:id/credit  Adjust reseller credit
GET    /reseller-expiry-media  Expiry media services
```

### Users
```
GET    /users              List users
POST   /users              Create user
PUT    /users/:id          Update user
DELETE /users/:id          Delete user
GET    /member-groups      List user/member groups
POST   /member-groups      Create group
```

### Servers (Multi-server)
```
GET    /servers            List servers
POST   /servers            Add server
PUT    /servers/:id        Update server
DELETE /servers/:id        Remove server
POST   /servers/:id/provision  SSH-provision remote node
GET    /server-relationships   List server-channel relationships
```

### Providers & Import
```
GET    /providers          List import providers
POST   /providers          Add provider
PUT    /providers/:id      Update provider
DELETE /providers/:id      Remove provider
POST   /providers/:id/import  Start import job (movies/series/live/m3u)
DELETE /providers/:id/import  Cancel import job
GET    /m3u-import/jobs    List import jobs
```

### EPG
```
GET    /epg                List EPG sources
POST   /epg                Add EPG source
DELETE /epg/:id            Remove EPG source
POST   /epg/refresh        Trigger EPG refresh
POST   /epg-assign/auto    Auto-assign EPG to channels
```

### Access Codes
```
GET    /access-codes       List access codes
POST   /access-codes       Create access code
PUT    /access-codes/:id   Update access code
DELETE /access-codes/:id   Delete access code
```

### Settings
```
GET    /settings           Get all settings
POST   /settings           Update settings (body: key-value pairs)
```

### Security
```
GET    /security/blocked-ips   List blocked IPs
POST   /security/blocked-ips   Block IP
DELETE /security/blocked-ips/:ip  Unblock IP
GET    /network-security       Network security config
PUT    /network-security       Update network security config
```

### Stats & Monitoring
```
GET    /stats              Overall stats (lines, channels, viewers)
GET    /connections        Active connections
GET    /activity           Recent activity log
GET    /system             System info (CPU, RAM, disk)
GET    /system/db          Database info
```

### Backups
```
GET    /backups            List backups
POST   /backups            Create backup
DELETE /backups/:id        Delete backup
POST   /backups/:id/restore  Restore from backup
```

### Other
```
GET    /transcode          Transcode profiles
POST   /transcode          Create transcode profile
PUT    /transcode/:id      Update profile
DELETE /transcode/:id      Delete profile

GET    /drm                DRM stream configs
POST   /drm                Add DRM stream
DELETE /drm/:id            Remove DRM stream

POST   /bulk-operations/purge    Purge all content of a type
POST   /bulk-operations/delete   Bulk delete by IDs

GET    /plex               Plex servers
POST   /plex               Add Plex server
GET    /tmdb               TMDB config
POST   /tmdb/resync        Re-sync TMDB metadata

GET    /telegram           Telegram bot config
PUT    /telegram           Update Telegram config

GET    /features           Feature flags
PUT    /features           Update feature flags
```

---

## Playback API (Session Auth)

```
POST /api/playback/play/:channelId/start
Response: { playbackUrl: "https://...", token: "..." }

POST /api/playback/play/:channelId/stop
Response: { success: true }

GET /api/playback/play/active
Response: [{ channelId, viewers, startedAt }]
```

---

## Dashboard (WebSocket + REST)

```
GET /api/dashboard/stats     Current stats snapshot
GET /api/dashboard/viewers   Active viewer count by channel

WebSocket: ws://host/ws
  → Client connects with valid session cookie
  → Server pushes events:
     { type: "stats", data: {...} }
     { type: "channel_status", channelId, status }
     { type: "viewer_count", channelId, count }
```

---

## Error Responses

All errors follow:
```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE"
}
```

Common status codes:
- `400` — Validation error
- `401` — Not authenticated
- `403` — Insufficient permissions or CSRF failure
- `404` — Resource not found
- `409` — Conflict (e.g., optimistic lock failure)
- `429` — Rate limit exceeded
- `500` — Internal server error (stack hidden in production)
