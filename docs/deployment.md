# Deployment Guide

> Last updated: 2026-04-08

## Production Checklist

### Security
- [ ] `.env` is NOT committed to git (`git status` should not show it)
- [ ] `SESSION_SECRET` is 64+ random hex characters
- [ ] `LINE_PASSWORD_SECRET` is 32+ random hex characters
- [ ] `STREAM_SECRET` is 32+ random hex characters
- [ ] `DB_PASSWORD` is a strong unique password
- [ ] `DEFAULT_ADMIN_ACCESS_CODE` is not `admin` or any default value
- [ ] `DEFAULT_RESELLER_ACCESS_CODE` is not `reseller` or any default value
- [ ] `NODE_ENV=production` is set
- [ ] `ALLOW_LOCAL_UNSIGNED_TS` is NOT set or is `0`
- [ ] SSL/TLS certificate is installed and valid (HSTS requires HTTPS)
- [ ] Firewall: only ports 80/443 public; 3000, 3306, 6379 internal only

### Application
- [ ] `npm run build:frontend` run — `public/js/dist/` populated
- [ ] `npm run bootstrap-db` run — all tables and migrations applied
- [ ] `npm run verify:preset` passes — FFmpeg working
- [ ] PM2 running and configured for auto-restart on boot
- [ ] Nginx configured and proxying correctly
- [ ] `GET /health` returns `{ status: "ok", db: "ok", redis: "ok" }`

### Infrastructure
- [ ] Redis running with persistence (`appendonly yes`)
- [ ] MariaDB running with automatic backups configured
- [ ] `IPTV_DISK_ROOT` has sufficient disk space (nginx mode, 100GB+ recommended)
- [ ] `logs/` directory writable
- [ ] Log rotation configured

### Docker (if using docker-compose)
- [ ] `change_me_*` placeholder secrets replaced with real values in `.env` or compose override
- [ ] `DB_ROOT_PASSWORD` set to a strong value
- [ ] Volumes mapped to persistent host paths

---

## PM2 Deployment

```bash
# Start
npm run pm2:start
# or:
pm2 start ecosystem.config.cjs

# Status
pm2 status

# Logs
pm2 logs novastreams-panel

# Restart after code changes
pm2 reload novastreams-panel   # zero-downtime reload

# Auto-start on boot
pm2 save
pm2 startup   # copy and run the printed command
```

**Important:** PM2 must run in single-process mode (`instances: 1`) until P4.4 is complete. `lib/state.js` in-memory Maps cannot be shared across cluster workers.

---

## Docker Deployment

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f panel

# Update
docker compose pull
docker compose up -d --build

# Stop
docker compose down
```

The compose file starts: `panel` (Node.js), `mariadb` (MariaDB 11), `redis` (Redis 7).

**Before running:** replace all `change_me_*` values in environment config. The server checks that secrets are set but does not validate strength — weak values will not block startup.

---

## Nginx Configuration

`deploy/nginx-iptv.conf` provides:
- HTTP → HTTPS redirect
- SSL termination
- WebSocket proxy (`/ws` upgrade)
- HLS static file serving (`/hls/` → `IPTV_DISK_ROOT`)
- Reverse proxy to Node `:3000`
- Gzip compression + cache headers

```bash
sudo cp deploy/nginx-iptv.conf /etc/nginx/sites-available/novastreams
sudo ln -s /etc/nginx/sites-available/novastreams /etc/nginx/sites-enabled/

# Edit for your domain:
sudo nano /etc/nginx/sites-available/novastreams
# Replace: panel.yourdomain.com, streams.yourdomain.com
# Replace: /var/iptv/media with your IPTV_DISK_ROOT

sudo nginx -t && sudo systemctl reload nginx
```

---

## SSL Certificate

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d panel.yourdomain.com -d streams.yourdomain.com
```

HSTS is auto-enabled when `NODE_ENV=production`. Ensure HTTPS is working before setting HSTS, or browsers will be locked out.

---

## Updates

```bash
cd /opt/novastreams-panel
git pull
npm install
npm run bootstrap-db     # idempotent — applies any new migrations
npm run build:frontend
pm2 reload novastreams-panel
```

---

## Health Monitoring

```
GET /health   → { status: "ok", uptime: 1234, db: "ok", redis: "ok" }
GET /readyz   → same
GET /healthz  → same
```

Returns `503` if MariaDB or Redis is unreachable. Use with UptimeRobot, Betterstack, or any HTTP monitor.

---

## Backups

```bash
# Manual DB backup
mysqldump -u iptv -p iptv_panel | gzip > backup-$(date +%Y%m%d).sql.gz

# Automated daily (crontab)
0 3 * * * mysqldump -u iptv -p'PASS' iptv_panel | gzip > /var/backups/iptv-$(date +\%Y\%m\%d).sql.gz
```

Panel built-in backups are stored in `data/backups/`. **Cloud backup is not yet implemented** — copy backups off-server regularly.

---

## Scaling

### Single-instance (current)
The app runs as one Node.js process. Increase CPU/RAM vertically. MariaDB pool size is 20 — increase if DB is the bottleneck.

### Multi-instance (requires P4.4 first)
Horizontal scaling requires:
1. Migrate `lib/state.js` Maps to Redis (channels, processes, tsBroadcasts)
2. Enable PM2 cluster mode (`instances: 'max'`, `exec_mode: 'cluster'`)

Until P4.4 is done, multiple processes will have split state and streaming will break.

### FFmpeg scaling (available now)
Add remote streaming nodes from Admin → Servers. Each node runs `agent/` and handles FFmpeg independently. `serverSelectionService.js` selects nodes by capacity.
