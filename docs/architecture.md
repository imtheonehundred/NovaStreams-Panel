# System Architecture

> Last updated: 2026-04-08 (post P1–P4 implementation)

## Overview

novastreams-panel is a Node.js/Express monolith following the Repository + Service pattern. It powers three role-based SPA portals (admin, reseller, client) and exposes a full Xtream-compatible streaming API. The original 700-line `server.js` god-file has been decomposed into `lib/boot/` modules.

## Layer Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                   NGINX (reverse proxy)                      │
│   Port 80/443 → Node :3000    │    /hls/* → IPTV_DISK_ROOT   │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│                     server.js (Express)                      │
│                                                              │
│  Middleware Stack:                                           │
│  Helmet+CSP → CORS → express-session → CSRF → Rate Limiters │
│  → Static files → Portal gateway → Auth → Routes            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  lib/boot/db.js      MariaDB pool + Redis + channels │   │
│  │  lib/boot/routes.js  All route mounts + /health      │   │
│  │  lib/boot/streaming.js  FFmpeg lifecycle + stability  │   │
│  │  lib/boot/jobs.js    Cron jobs + Telegram + webhooks │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┬──────────┬──────────┬────────────────────┐    │
│  │  Auth    │  Admin   │Reseller  │  Xtream / Stream   │    │
│  │  Routes  │ (36 sub) │  Routes  │    Routes          │    │
│  └──────────┴──────────┴──────────┴────────────────────┘    │
│                                                              │
│  ┌────────────────────┐  ┌───────────────────────────────┐  │
│  │   41 Services      │  │   26 Lib Modules              │  │
│  │  serverSelection   │  │  crypto, cache, state,        │  │
│  │  serverRuntime     │  │  panel-access, crons,         │  │
│  │  serverProxy       │  │  ffmpeg-args, etc.            │  │
│  └────────────────────┘  └───────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │   21 Repositories (parameterized SQL → mysql2 pool)   │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────┬──────────────────────────┬──────────────────────┘
             │                          │
  ┌──────────▼──────┐        ┌──────────▼──────────┐
  │   MariaDB/MySQL  │        │       Redis          │
  │   Pool size: 20  │        │   Sessions (req),    │
  │   InnoDB utf8mb4 │        │   Rate limits,       │
  │   DATETIME stamps│        │   Access code cache  │
  └──────────────────┘        └─────────────────────┘
             │
  ┌──────────▼──────────────────────────────────────┐
  │         FFmpeg streaming infrastructure          │
  │  node mode:  FFmpeg → Node → TS fan-out          │
  │  nginx mode: FFmpeg → HLS segments on disk       │
  │  Remote agent nodes via SSH (provisionService)   │
  └─────────────────────────────────────────────────┘
```

## Access Control Flow

```
User visits /:accessCode
  → registerPortalRoutes validates code in DB (cached 60s in Redis)
  → Sets session: {accessCodeId, portalRole, accessCode}
  → Serves correct SPA shell (index.html / reseller.html / client.html)

User submits login form
  → POST /api/auth/login
  → Validates gateway session exists + role matches
  → bcrypt verifies password
  → req.session.regenerate() — NEW session ID issued (session fixation prevented)
  → Sets session.userId
  → Writes to audit_log

Authenticated requests
  → requireAuth: session.userId + access code validation (per-req memoized + Redis cache)
  → requireAdminAuth: requireAuth + isAdmin(userId) DB check (try/catch, errors → next(err))

API Key requests
  → X-API-Key or Authorization: Bearer header
  → 12-char prefix lookup → bcrypt verify
  → apiKeyLimiter: 100/min per key prefix
```

## Streaming Architecture

```
Admin starts channel
  → ffmpegLifecycleService.startStream() (in lib/boot/streaming.js)
  → FFmpeg spawned with args from lib/ffmpeg-args.js

nginx mode:
  FFmpeg → segments → IPTV_DISK_ROOT/{channelId}/
  Client → nginx → /hls/{channelId}/index.m3u8

node mode:
  FFmpeg → Node.js pipe → lib/state.tsBroadcasts Map
  Client → routes/stream.js → pipes TS chunk to response

On-demand:
  First viewer request → lib/on-demand-live.js
  → ensureOnDemandStreamIfNeeded()
  → FFmpeg starts, prebuffer from lib/ts-prebuffer.js served immediately

Stability:
  lib/stability-monitor.js probes channels periodically
  → Detects stalls, crashes
  → Calls auto-fix actions in ffmpegLifecycleService

Optimistic locking (channels):
  channelRepository.updateChannelRow(id, data, expectedVersion)
  → WHERE id=? AND version=?
  → If affectedRows=0 → throws ConflictError
  → Caller resyncs and retries
```

## Frontend Architecture

```
3 SPA entry points (Vite):
  public/js/src/main.js           → public/js/dist/admin.js
  public/js/src/reseller-main.js  → public/js/dist/reseller.js
  public/js/src/client-main.js    → public/js/dist/client.js

Core modules (eager loaded):
  core/api.js        — fetch wrapper, CSRF header injection
  core/router.js     — client-side SPA routing (lazy loads page chunks)
  core/state.js      — shared frontend state
  core/websocket.js  — /ws WebSocket for dashboard push
  core/ui-common.js  — delegated event listener system (no inline handlers)

Page modules (~50, lazy loaded as Vite chunks):
  Each exports init(container) function
  All event handling via delegated listeners (CSP compliant)

Security:
  - CSP enabled: scriptSrc 'self', no unsafe-inline scripts
  - All inline onclick/onchange/onsubmit removed from HTML shells
  - CSRF token from GET /api/auth/csrf-token, sent as X-CSRF-Token
```

## Server Service Decomposition

The original `serverService.js` (1059 lines) has been split:

```
services/serverService.js            ← compatibility facade (thin)
  ↓ delegates to:
services/serverSelectionService.js   ← capacity selection, load balancing
services/serverRuntimeService.js     ← runtime session reconciliation
services/serverProxyService.js       ← URL resolution, public base URL
services/serverService.shared.js     ← shared constants/helpers
```

## Health Endpoints

```
GET /health   → { status: 'ok', uptime, db: 'ok', redis: 'ok' }
GET /readyz   → same (alias)
GET /healthz  → same (alias)

Returns 503 if MariaDB or Redis is unreachable.
Use /health for load balancer probes and uptime monitors.
```

## Scaling Constraint

`lib/state.js` stores channel config and FFmpeg process state in in-memory Maps. These cannot be shared across PM2 cluster workers. The app is **single-process only** until P4.4 is completed (moving state Maps to Redis). Do not enable `exec_mode: cluster` until then.
