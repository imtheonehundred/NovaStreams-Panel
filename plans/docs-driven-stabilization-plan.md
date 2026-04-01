# NovaStreams Docs-Driven Stabilization Plan

## Basis

This plan is based on the current repository docs that exist locally:

- `CLAUDE.md`
- `docs/ARCHITECTURE_AUDIT.md`
- `docs/BACKEND_MAP.md`
- `docs/FRONTEND_MAP.md`
- `docs/DATABASE_MAP.md`
- `docs/FEATURE_MATRIX.md`
- `docs/CURRENT_IMPLEMENTED_STATE.md`
- `docs/TECHNICAL_DEBT_AND_RISKS.md`
- `docs/IMPLEMENTATION_RECOMMENDATIONS.md`
- `docs/REPOSITORY_FULL_AUDIT_REPORT.md`

Important doc gap:

- the global working guide references several audit/spec files that are not present in this repo copy
- that mismatch should be treated as a documentation problem in its own right

## Main Problems

### 1. Distributed live runtime is only partially real

Documented truth:

- server selection, placement tables, failover logic, proxy relationships, heartbeat, and server UI exist
- full remote live start/stop/runtime ownership does not

Impact:

- the product can look more distributed than it really is
- operators can assume multi-node runtime guarantees that the code does not yet provide

### 2. Runtime ownership is split

Documented truth:

- `server.js` is the real local live runtime owner
- `services/streamManager.js` overlaps with that story in routes and tests

Impact:

- lifecycle ownership is ambiguous
- future stream work has a high regression risk

### 3. Security hardening is behind the UI surface

Documented truth:

- no CSRF protection for cookie-authenticated panel routes
- stream limiter exists but is not mounted
- CSP is disabled
- HSTS is off by default
- CORS is permissive
- secrets still exist in plaintext or weakly protected storage
- RBAC, VPN/ASN, and multi-login surfaces are more complete than enforcement

Impact:

- the panel is not yet production-safe without caveats
- the UI can overstate actual protection depth

### 4. Operational telemetry is only partially truthful

Documented truth:

- dashboard and websocket surfaces are real
- some metrics are placeholders or undercounted
- health monitoring has an auth mismatch
- Redis boot logging can overstate success
- local and remote session/viewer truth is not unified

Impact:

- operators can make bad decisions from incomplete runtime data

### 5. Database evolution is ad hoc

Documented truth:

- schema changes are split across `scripts/schema.sql`, bootstrap scripts, one-off SQL, and runtime `ensure*()` logic in `lib/db.js`
- drift already exists between schema artifacts and reality
- channels depend heavily on `channels.json_data`

Impact:

- upgrades are harder to reason about
- schema drift and persistence bugs are easier to introduce

### 6. Monolith risk is concentrated in a few files

Highest-risk files called out repeatedly in the docs:

- `server.js`
- `routes/admin.js`
- `lib/db.js`
- `public/js/app.js`
- `public/index.html`

Impact:

- unrelated changes can have large blast radius
- maintainability is below the feature breadth of the product

### 7. UI and settings pages overstate some capabilities

Documented examples:

- server area implies more runtime authority than exists
- cloud backup settings exist, but uploads are de-scoped
- RBAC pages exist, but enforcement is weak
- security pages manage partially wired controls
- EPG mass assignment and auto-match return `410`

Impact:

- trust gap between what operators see and what the system truly guarantees

### 8. Test quality is stronger on contracts than real behavior

Documented truth:

- many tests are source-string or structural assertions
- FFmpeg, MariaDB, Redis, provisioning, and multi-node behavior are not deeply proven end-to-end

Impact:

- the suite catches drift better than runtime breakage

### 9. Some state is still fragile or non-durable

Documented examples:

- API playback uses in-memory session tokens
- `services/userService.js` writes to `data/user_meta.json`
- import jobs are memory-resident
- multi-login detection is mostly in-memory

Impact:

- cluster safety is weak
- restart safety is inconsistent across features

## Plan Principles

1. Stabilize before expanding.
2. Preserve public playback and portal contracts.
3. Prefer truth-alignment before new distributed features.
4. Use the smallest changes that reduce risk.
5. Upgrade behavior tests before large refactors.

## Recommended Direction

Short-term recommendation:

1. Narrow claims where the code is only partial.
2. Harden security and telemetry truth first.
3. Reduce monolith risk only after the runtime and safety story is more honest.
4. Defer major new feature work until the above is complete.

This is safer than trying to jump directly into full remote live orchestration.

## Execution Plan

### Phase 0: Documentation Truth Alignment

Goal:

- make docs, guides, and visible claims match the current repo

Tasks:

- reconcile `CLAUDE.md` references to missing docs
- add a single docs index showing which audit/spec docs are canonical and which are absent
- clearly label de-scoped features in docs and admin UI copy
- add a simple capability matrix page or internal doc for operators

Exit criteria:

- no required-guide references to non-existent files
- no major de-scoped feature presented as fully implemented in docs

### Phase 1: Security And Safety Baseline

Goal:

- close the highest-risk security gaps before feature expansion

Tasks:

- add CSRF protection for cookie-authenticated admin and reseller flows
- mount and verify stream endpoint rate limiting
- review CORS behavior and tighten where compatibility allows
- enable stronger production defaults for headers where safe
- inventory plaintext secrets across env, DB tables, and settings
- replace or reduce plaintext storage for server, backup, and Plex credentials where possible
- add restore preflight and verification checks

Exit criteria:

- CSRF enforced on cookie-authenticated panel mutations
- stream limiter active on public playback endpoints
- secret inventory documented and highest-risk plaintext paths reduced

### Phase 2: Runtime Truth And Distributed Honesty

Goal:

- remove ambiguity about what the distributed layer really owns

Tasks:

- choose and document one authoritative stream runtime owner for live paths
- audit `services/streamManager.js` and either narrow it or align it with `server.js`
- review all server-area UI copy and labels so readiness-aware routing is not described as full orchestration
- normalize placement and session writes so local and remote paths feed the same operational truth where possible
- document the exact difference between local runtime ownership and remote readiness-aware routing

Exit criteria:

- no internal ambiguity about which module owns live runtime lifecycle
- server-area docs/UI no longer overclaim distributed runtime capabilities
- session and placement truth is measurably less path-dependent

### Phase 3: Monitoring And Telemetry Truthfulness

Goal:

- make dashboard and health information trustworthy enough for operators

Tasks:

- fix the health-check auth mismatch
- stop logging Redis as connected when the connection failed
- unify or clearly distinguish local versus remote viewer/session counts
- wire honest local viewer counters into the dashboard path
- label placeholders as placeholders or remove them
- define which metrics are canonical and which are advisory

Exit criteria:

- health monitor runs through a valid auth model
- Redis startup truth is accurate
- dashboards distinguish measured values from estimated or unavailable data

### Phase 4: Database Discipline And Persistence Cleanup

Goal:

- reduce drift and make future changes safer

Tasks:

- define one migration workflow for future schema changes
- audit and repair known schema drift
- stop adding new runtime schema changes only through `ensure*()` logic
- review `channels.json_data` risk boundaries and document safe change rules
- plan removal or containment of file-backed user metadata
- plan durable storage for fragile in-memory operational features where needed

Exit criteria:

- future DB changes follow one documented path
- known drift items are tracked and prioritized
- persistence responsibilities are clearer across DB, Redis, filesystem, and memory

### Phase 5: Test Upgrade For Real Behavior

Goal:

- raise confidence in runtime-critical behavior

Tasks:

- add FFmpeg smoke tests around startup and argument generation
- add MariaDB plus Redis integration tests for line/runtime/session flows
- add live-process tests for remote movie/episode agent delivery
- add provisioning dry-run and failure-mode tests
- add telemetry truth tests that assert behavior, not strings
- reduce reliance on source-string assertions where behavior can be executed instead

Exit criteria:

- critical runtime flows have behavior tests
- the test suite gives real confidence beyond contract drift detection

### Phase 6: Controlled Boundary Extraction

Goal:

- lower monolith risk without changing public contracts

Tasks:

- extract narrow, existing responsibility seams from `server.js`
- split `routes/admin.js` by domain only where ownership is already clear
- continue moving `public/js/app.js` domain logic into `public/js/modules/`
- keep `window.APP`, page IDs, and route contracts stable during extraction

Exit criteria:

- smaller blast radius in the highest-risk files
- no route, playback, or shell contract regressions

### Phase 7: Feature Completion Only After Stabilization

Candidates after Phases 0-6:

- real EPG mass assignment
- real EPG auto-match
- enforceable RBAC
- real cloud backup uploads
- true remote live orchestration if still strategically required

Rule:

- do not treat these as priority work until truth, safety, and tests improve first

## Suggested Order For The Next 90 Days

1. Phase 0 documentation truth alignment.
2. Phase 1 security baseline.
3. Phase 2 runtime ownership and distributed honesty cleanup.
4. Phase 3 telemetry truth fixes.
5. Phase 5 behavior-test upgrades for the touched areas.
6. Phase 6 controlled extractions.

## Immediate Top 10 Actions

1. Reconcile missing doc references in `CLAUDE.md` and docs guidance.
2. Add CSRF protection to cookie-authenticated panel routes.
3. Mount the stream limiter on public playback routes.
4. Fix Redis startup truth so failed connections are not reported as healthy.
5. Fix the health-monitor auth mismatch.
6. Decide and document the authoritative owner of live runtime lifecycle.
7. Audit `services/streamManager.js` against `server.js` and remove overlap where possible.
8. Label de-scoped UI features clearly, especially server-area, cloud backup, and security surfaces.
9. Add one MariaDB plus Redis integration test around runtime/session truth.
10. Add one live-process integration test for remote movie or episode delivery.

## Success Measures

- operators can tell which features are fully implemented, partial, or de-scoped
- public playback security is stronger without breaking route contracts
- dashboard data is honest about what is measured versus inferred
- runtime ownership is no longer ambiguous
- schema changes are more disciplined
- tests prove runtime behavior, not just source structure

## Bottom Line

The project's biggest problem is not lack of scope.

It is the gap between what the panel already exposes and what the underlying runtime, security, telemetry, and migration systems can guarantee with confidence.

The right next move is stabilization, truth-alignment, and safety work before major new features.
