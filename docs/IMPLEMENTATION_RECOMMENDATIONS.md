# Implementation Recommendations

This file is intentionally about stabilization priorities, not new feature ideation.

## Highest Priority Before Major New Features

### 1. Make Distributed Live Runtime Honest

Why:
- server selection, placement tables, failover, and server UI imply more live-runtime ownership than the code currently provides

What to do next:
- either complete remote live runtime ownership end-to-end
- or explicitly narrow the UI and docs so they only claim readiness-aware routing, not orchestration

Target files:
- `server.js`
- `services/streamManager.js`
- `services/serverService.js`
- `routes/stream.js`
- `routes/admin.js`

### 2. Harden Security Before Expanding Scope

Why:
- the panel is broad enough now that security debt is more dangerous than feature shortage

What to do next:
- add CSRF protection for cookie-authenticated panel routes
- mount real stream endpoint rate limiting
- stop storing sensitive service secrets in plaintext where possible
- review unsigned local/admin preview bypasses for production defaults
- reduce permissive CORS behavior

### 3. Make Ops Metrics Match Reality

Why:
- operators will make decisions based on dashboards, server cards, and live-connection views

What to do next:
- fix health-check routing/auth mismatch
- stop reporting Redis as connected when `redis.connect()` failed
- unify viewer/session truth so local and remote playback both appear in admin telemetry
- remove placeholder metrics or label them as placeholders

### 4. Reduce Monolith Risk Without Breaking Contracts

Why:
- the project is large enough that `server.js`, `routes/admin.js`, and `public/js/app.js` are now delivery risks

What to do next:
- extract only responsibility seams that already exist in code
- do not change route shapes or frontend global contracts during stabilization extractions
- keep runtime behavior unchanged while moving code into narrower owners

### 5. Upgrade Test Quality

Why:
- the suite passes, but much of it proves structure rather than behavior

What to do next:
- add behavior tests for remote movie/episode delivery
- add FFmpeg integration smoke tests around `buildFfmpegArgs` and startup expectations
- add MariaDB/Redis-backed integration tests for line/runtime/session flows
- add provisioning dry-run tests
- reduce reliance on source-string assertions for frontend/runtime phases

## Panel Gaps / What Is Missing In The Panel

### Missing Admin Features

- real EPG mass assignment
- real EPG auto-match
- true end-to-end RBAC enforcement behind the roles UI
- real cloud backup provider execution
- a trustworthy remote-live runtime control surface

### Weak Workflows

- server provisioning depends on SSH scripting and first-heartbeat polling, with limited safety rails
- backup settings surface is broader than backup behavior reality
- security pages manage features that are only partially enforced
- distributed server monitoring is more descriptive than operationally authoritative

### Weak Pages

- legacy admin content flows still dominated by `public/js/app.js`
- settings page mixes real settings with parity/de-scoped surfaces
- security page looks more complete than the enforcement path behind it
- reseller portal is narrower and less mature than admin
- client portal is isolated and simplistic

### Missing Runtime Behaviors

- remote live start/stop orchestration
- live proxy-delivery execution
- fully unified runtime session truth across local and remote playback
- reliable viewer counters on channels and dashboards

### Missing Safety / Validation

- CSRF protection
- mounted stream rate limiter
- stronger secret handling for server, cloud, and Plex credentials
- restore verification and dry-run safety
- cluster-safe session/token handling for API playback

### Missing Testing

- end-to-end FFmpeg runtime tests
- real MariaDB plus Redis integration tests
- remote agent movie/episode delivery tests in a live process environment
- provisioning path tests beyond isolated helper behavior
- honest dashboard-truth tests that validate runtime/session counters rather than strings

### Missing UX / Operational Polish

- one coherent routing model across shells
- removal of inline handler fragility
- clearer labeling of de-scoped features in the admin UI
- dashboards that distinguish measured values from placeholders
- better alignment between server-area marketing language and actual runtime authority

## Suggested Order Of Work

1. Stabilize distributed live truth or narrow claims.
2. Harden security defaults and secret handling.
3. Fix monitoring truthfulness and Redis/health handling.
4. Improve tests around real behavior.
5. Then consider new major feature work.

## Recommendation Summary

The next wins should not be new screens.

They should be truth-alignment, safety, and confidence work on the architecture that already exists.
