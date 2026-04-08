# Developer Guide

> Last updated: 2026-04-08

## Getting Started

```bash
git clone <repo-url> novastreams-panel
cd novastreams-panel
npm install
cp .env.example .env
# Edit .env — set all required variables
npm run bootstrap-db
npm run build:frontend
npm run dev          # Node.js watch mode (terminal 1)
npm run dev:vite     # Vite HMR (terminal 2)
```

Visit `http://localhost:3000/<your-admin-access-code>` to access the panel.

---

## Project Structure

```
novastreams-panel/
├── server.js               Entry point — wires lib/boot/* modules (~515 lines)
├── CLAUDE.md               AI assistant guidance (read this first)
├── PLAN.md                 Fix and feature roadmap with completion tracker
├── config/constants.js     App-wide constants
├── middleware/
│   ├── csrf.js             Per-session CSRF protection
│   ├── errorHandler.js     Global error response formatter
│   ├── rateLimiter.js      4-tier Redis-backed rate limiting
│   ├── securityHeaders.js  Helmet + CSP + HSTS
│   ├── validation.js       Joi factory validators
│   └── schemas/            Joi schema files per domain
│       ├── line.js
│       ├── channel.js
│       └── movie.js
├── lib/
│   ├── boot/               Server bootstrap modules
│   │   ├── db.js           MariaDB + Redis init, channel preload
│   │   ├── routes.js       Route mounting, /health endpoint
│   │   ├── streaming.js    FFmpeg lifecycle, stability monitor
│   │   └── jobs.js         Cron jobs, Telegram, webhooks
│   ├── db.js               DB façade — import this for all data access
│   ├── mariadb.js          mysql2 pool wrapper
│   ├── crypto.js           Bcrypt + AES-256-GCM — all crypto goes here
│   ├── cache.js            Redis TTL cache wrappers
│   ├── state.js            In-memory runtime state (channels, processes)
│   ├── panel-access.js     Auth middleware (requireAuth, requireAdminAuth)
│   └── panel-session.js    express-session options + regenerateSession()
├── routes/                 Express routers (56 files)
│   ├── admin.js            Admin route entry — mounts all sub-routes
│   ├── admin.lines.js      Line management (Joi-validated)
│   ├── admin.channels.js   Channel management (Joi-validated)
│   ├── admin.movies.js     Movie management (Joi-validated)
│   ├── auth.js             Auth endpoints
│   ├── xtream.js           Xtream API compatibility
│   ├── stream.js           Stream serving (HMAC-verified)
│   └── ...
├── services/               Business logic (41 files)
│   ├── serverSelectionService.js  Server LB/capacity
│   ├── serverRuntimeService.js    Runtime session reconciliation
│   ├── serverProxyService.js      URL resolution
│   ├── serverService.js           Compatibility facade
│   ├── auditService.js            Audit log helper
│   ├── ffmpegLifecycleService.js  FFmpeg start/stop/restart
│   ├── lineService.js             Line auth + enforcement
│   ├── securityService.js         HMAC token signing
│   └── logger.js                  Winston logger
├── repositories/           Raw SQL modules (21 files)
│   ├── auditLogRepository.js  Audit log insert/query
│   ├── channelRepository.js   Channels with optimistic locking
│   ├── lineRepository.js      Lines (no legacy plaintext password)
│   └── ...
├── public/
│   ├── index.html          Admin SPA shell (no inline handlers)
│   ├── reseller.html       Reseller SPA shell (no inline handlers)
│   ├── client.html         Client SPA shell (no inline handlers)
│   └── js/src/             Vite source
│       ├── main.js         Admin entry
│       ├── core/           api.js, router.js, state.js, websocket.js, ui-common.js
│       ├── shared/         crud-helpers, pagination, modal-helpers, formatters...
│       └── pages/          ~50 page modules (lazy chunks)
├── scripts/
│   ├── schema.sql          Full DB schema (audit_log, channels.version, DATETIME stamps)
│   ├── migrations.js       Incremental migrations (idempotent)
│   ├── bootstrap-database.js
│   └── seed.js             Rejects default access codes — forces random values
├── Dockerfile              Multi-stage Node 20 Alpine build
├── docker-compose.yml      panel + mariadb + redis services
└── tests/
    ├── unit/               Jest unit tests (90+)
    ├── integration/        Supertest route tests
    └── e2e/                Playwright end-to-end
```

---

## Core Conventions

### Data access — always through `lib/db.js`
```js
// CORRECT
const db = require('../lib/db');
const line = await db.getLineById(id);

// WRONG — never import repositories directly outside lib/db.js
const repo = require('../repositories/lineRepository');
```

### Encryption — always through `lib/crypto.js`
```js
const { hashPassword, verifyPassword, encryptLinePassword, decryptLinePassword } = require('../lib/crypto');
// Never use require('crypto') directly in routes or services
```

### Logging — always through `services/logger.js`
```js
const logger = require('../services/logger');
logger.info('Channel started', { channelId, mode });
logger.error('FFmpeg crash', { channelId, code });
// NEVER use console.log or console.error in production code
```

### Validation — always Joi before touching req.body
```js
const { validateBody } = require('../middleware/validation');
const Joi = require('joi');

const schema = Joi.object({ username: Joi.string().min(1).max(100).required() });

router.post('/', csrfProtection, validateBody(schema), async (req, res) => {
  // req.body is validated and typed
});
```

### Audit logging — on all admin state changes
```js
const auditService = require('../services/auditService');

// After creating/updating/deleting:
await auditService.log(req.session.userId, 'line.create', 'line', newLineId, { username }, req);
```

### Frontend event handling — delegated only, no inline handlers
```js
// CORRECT — delegated listener (CSP compliant)
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-action="delete-line"]')) {
    deleteLine(e.target.dataset.id);
  }
});

// WRONG — CSP will block this
// <button onclick="deleteLine(1)">Delete</button>
```

---

## Adding a New Admin Feature

### 1. Database (if needed)
```js
// scripts/migrations.js — add migration
{
  version: '20260408_add_feature',
  up: async (db) => {
    await db.execute(`CREATE TABLE IF NOT EXISTS your_table (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, ...)`);
  }
}
```
Also update `scripts/schema.sql`.

### 2. Repository (`repositories/yourFeatureRepository.js`)
```js
const { query, queryOne, insert, update, remove } = require('../lib/mariadb');

async function getAll(limit = 50, offset = 0) {
  return query('SELECT id, name FROM your_table LIMIT ? OFFSET ?', [limit, offset]);
}
async function getById(id) {
  return queryOne('SELECT * FROM your_table WHERE id = ?', [id]);
}
async function create(data) { return insert('your_table', data); }

module.exports = { getAll, getById, create };
```

Export from `lib/db.js`:
```js
const yourRepo = require('../repositories/yourFeatureRepository');
module.exports = { ..., getAllYourFeature: yourRepo.getAll, ... };
```

### 3. Joi Schema (`middleware/schemas/yourfeature.js`)
```js
const Joi = require('joi');

const createSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  enabled: Joi.boolean().default(true),
});

module.exports = { createSchema };
```

### 4. Route (`routes/admin.yourFeature.js`)
```js
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { csrfProtection } = require('../middleware/csrf');
const { validateBody } = require('../middleware/validation');
const { createSchema } = require('../middleware/schemas/yourfeature');
const auditService = require('../services/auditService');

router.get('/', async (req, res, next) => {
  try {
    res.json(await db.getAllYourFeature(50, 0));
  } catch (err) { next(err); }
});

router.post('/', csrfProtection, validateBody(createSchema), async (req, res, next) => {
  try {
    const id = await db.createYourFeature(req.body);
    await auditService.log(req.session.userId, 'yourfeature.create', 'yourfeature', id, req.body, req);
    res.json({ id });
  } catch (err) { next(err); }
});

module.exports = router;
```

Mount in `routes/admin.js`:
```js
router.use('/your-feature', require('./admin.yourFeature'));
```

### 5. Frontend Page (`public/js/src/pages/your-feature.js`)
```js
import { api } from '../core/api.js';

export async function init(container) {
  container.innerHTML = `<div id="your-feature-page">...</div>`;

  // Delegated event listeners only — no inline handlers
  container.addEventListener('click', (e) => {
    if (e.target.matches('[data-action="load"]')) loadData();
  });

  await loadData();
}

async function loadData() {
  const data = await api.get('/api/admin/your-feature');
  // render...
}
```

Register in `lib/pageRegistry.js`:
```js
// Add to adminPages array:
'your-feature',
```

### 6. Tests
- Unit: `tests/unit/services/yourFeatureService.test.js`
- Integration: `tests/integration/routes/admin.yourFeature.test.js`

---

## Running Tests

```bash
npm test                          # all tests
npm run test:coverage             # with coverage report
npx jest tests/unit/lib/crypto.test.js   # single file
npx jest --watch                  # watch mode
```

Tests use a real test database bootstrapped in `tests/setup.js`.

---

## Frontend Development

```bash
npm run dev:vite     # Vite HMR at http://localhost:5173
npm run build:frontend  # production build → public/js/dist/
```

`public/js/dist/` is in `.gitignore` — never commit it.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | express-session key (64+ hex) |
| `LINE_PASSWORD_SECRET` | Yes | AES-256-GCM key for line passwords |
| `STREAM_SECRET` | Yes | HMAC key for stream URL signing |
| `DB_HOST` | Yes | MariaDB host |
| `DB_PORT` | Yes | MariaDB port (default 3306) |
| `DB_NAME` | Yes | Database name |
| `DB_USER` | Yes | Database username |
| `DB_PASSWORD` | Yes | Database password |
| `REDIS_HOST` | Yes | Redis host (sessions depend on Redis) |
| `REDIS_PORT` | Yes | Redis port (default 6379) |
| `STREAMING_MODE` | Yes | `node` or `nginx` |
| `PUBLIC_STREAM_BASE_URL` | Yes | Base URL for stream/playlist URLs |
| `IPTV_DISK_ROOT` | nginx mode | HLS segment output path |
| `DEFAULT_ADMIN_ACCESS_CODE` | Yes | Admin portal access code (not `admin`) |
| `DEFAULT_RESELLER_ACCESS_CODE` | Yes | Reseller portal access code (not `reseller`) |
| `PORT` | No | HTTP port (default 3000) |
| `ALLOW_LOCAL_UNSIGNED_TS` | No | Dev only — NEVER in production |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot notifications |
| `ENABLE_SERVER_PROVISIONING` | No | Enable SSH remote node provisioning |
