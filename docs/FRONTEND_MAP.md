# Frontend Map

## Shells

| Shell | File | Reality |
| --- | --- | --- |
| Admin | `public/index.html` | main panel shell with many hidden page sections |
| Reseller | `public/reseller.html` | smaller dedicated shell |
| Client | `public/client.html` | standalone page with inline JS |

Access model:
- admin and reseller shells are access-code gateway pages served by `server.js`
- `client.html` is a separate direct shell and is not behind the admin/reseller gateway model

## Routing Model

Admin routing is hybrid:
- server-side path gating in `server.js`
- client-side page normalization in `public/js/modules/router.js`
- legacy hash compatibility in `public/js/app.js`
- `localStorage.lastPage` fallback

Reseller routing is simpler:
- hash routing in `public/js/reseller-app.js`
- `localStorage.rslLastPage` fallback

Client routing is minimal:
- no real page router
- login just swaps between login and panel sections

## State Model

Admin state model:
- mostly mutable closure variables in `public/js/app.js`
- tiny core state helper in `public/js/modules/state.js`
- no centralized store

Reseller state model:
- local closure state in `public/js/reseller-app.js`

Client state model:
- direct DOM mutation inside `public/client.html`

## `app.js` Role

`public/js/app.js` is still the main admin application controller.

It handles:
- auth bootstrap
- page switching
- module context construction
- a large amount of un-extracted feature code
- compatibility exports through `window.APP`

This file is effectively a hybrid between a modern module host and a legacy monolith.

## Module Ownership

Core helpers under `public/js/modules/`:
- `router.js`
- `state.js`
- `api.js`
- `ui-common.js`
- `websocket.js`
- `utils.js`

Domain modules:
- `dashboard.js`
- `lines.js`
- `streams.js`
- `server-area.js`
- `settings.js`
- `security.js`
- `backups.js`
- `monitor.js`
- `reseller-members.js`

What is still not truly modularized:
- movies
- series
- episodes
- EPG pages
- access codes
- panel users
- parts of settings and security flows

Those areas still lean directly on `app.js`.

## Global Compatibility Contracts

The frontend still depends on global objects:
- `window.APP`
- `window.RSL`
- `CLIENT`

Inline handler reality:
- `public/index.html` uses inline `onclick` in navigation and page controls
- `public/js/app.js` also generates inline handler markup strings
- `public/reseller.html` uses inline `onclick` with `RSL.*`
- `public/client.html` uses inline `onclick` with `CLIENT.*`

This is a real compatibility constraint, not a cosmetic detail.

## Strong Pages

Relatively strong frontend areas:
- Dashboard
  - best visual rebuild
  - meaningful websocket integration
  - dedicated module exists
- Lines
  - strongest operational CRUD page
  - filtering, pagination, and action-menu structure are clear
- Server Area
  - one of the better-extracted admin domains
  - proxy and order pages are coherent

## Weak Pages

Weaker or more coupled areas:
- Movies / Series / Episodes
  - broad feature surface but still heavily controlled by `app.js`
- Settings
  - broad parity surface, but mixes real and de-scoped features
- Security
  - several UI surfaces outpace actual enforcement
- Client portal
  - isolated, inline, and low-reuse
- Reseller portal
  - functional, but much smaller and less mature than admin

## Fragile UI Parts

Most fragile frontend seams:
- route alias sync between `server.js`, `router.js`, and `index.html`
- global `APP` export surface used by inline handlers
- giant one-shell admin DOM in `public/index.html`
- mixed path-routing and hash-routing behavior
- CSS layering between `style.css` and `premium.css`

## Frontend Strength Assessment

| Area | State | Notes |
| --- | --- | --- |
| Admin shell breadth | Implemented | broad surface and many pages exist |
| Admin maintainability | Weak | `app.js` and `index.html` are oversized |
| Dashboard | Strong | one of the better modernized areas |
| Lines page | Strong | best operational page |
| Streams page | Partial | much better than legacy, still coupled |
| Server pages | Partial to strong | meaningful extraction, but backend truth is partial |
| Reseller portal | Partial | works, but limited and visually simpler |
| Client portal | Weak | standalone inline stack |

## Frontend Gaps

- no unified state architecture
- no component framework boundary
- no removal of inline handlers yet
- no unified shell for admin, reseller, and client
- no strong guarantee that route aliases, page IDs, and sidebar links stay in sync

## Practical Frontend Conclusion

The frontend is not unfinished in the sense of missing screens.

It is unfinished in the sense that the page surface is broader than the architecture quality underneath it.

The admin panel is usable now, but it still carries large legacy-style coupling costs.
