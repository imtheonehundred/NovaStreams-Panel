# Setup & Installation Guide

> Last updated: 2026-04-08

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥20 | Use nvm or fnm to manage versions |
| MariaDB | ≥10.6 | MySQL 8 also works |
| Redis | ≥7 | **Required** — sessions are stored in Redis |
| FFmpeg | ≥6 | Must be in PATH or set `FFMPEG_PATH` |
| Nginx | Any recent | Required only for `STREAMING_MODE=nginx` |

---

## Option A: Manual Installation (Ubuntu/Debian)

### 1. Install system dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# MariaDB
sudo apt-get install -y mariadb-server
sudo mysql_secure_installation

# Redis
sudo apt-get install -y redis-server
sudo systemctl enable redis-server

# FFmpeg
sudo apt-get install -y ffmpeg

# Nginx (nginx streaming mode only)
sudo apt-get install -y nginx
```

### 2. Install and configure

```bash
git clone <repo-url> /opt/novastreams-panel
cd /opt/novastreams-panel
npm install
```

### 3. Create the database

```sql
-- Run in MariaDB as root:
CREATE DATABASE iptv_panel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'iptv'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON iptv_panel.* TO 'iptv'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Configure environment

```bash
cp .env.example .env
nano .env
```

Set all required variables:

```env
# Required — server WILL NOT START without these
SESSION_SECRET=<openssl rand -hex 64>
LINE_PASSWORD_SECRET=<openssl rand -hex 32>
STREAM_SECRET=<openssl rand -hex 32>

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=iptv_panel
DB_USER=iptv
DB_PASSWORD=YOUR_STRONG_PASSWORD

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

STREAMING_MODE=nginx
PUBLIC_STREAM_BASE_URL=https://streams.yourdomain.com
IPTV_DISK_ROOT=/var/iptv/media

# Change these — NEVER use "admin" or "reseller"
DEFAULT_ADMIN_ACCESS_CODE=<random string>
DEFAULT_RESELLER_ACCESS_CODE=<random string>

NODE_ENV=production
PORT=3000
```

### 5. Bootstrap database

```bash
npm run bootstrap-db
```

Runs `scripts/schema.sql` + all migrations in `scripts/migrations.js`. Safe to re-run.

### 6. Build frontend

```bash
npm run build:frontend
```

### 7. Configure nginx

```bash
sudo cp deploy/nginx-iptv.conf /etc/nginx/sites-available/novastreams
sudo ln -s /etc/nginx/sites-available/novastreams /etc/nginx/sites-enabled/
# Edit for your domain, then:
sudo nginx -t && sudo systemctl reload nginx
```

### 8. SSL certificate

```bash
sudo certbot --nginx -d panel.yourdomain.com -d streams.yourdomain.com
```

### 9. Start

```bash
npm run pm2:start
pm2 save
pm2 startup   # run the printed command to enable auto-restart
```

### 10. Verify

```bash
curl http://localhost:3000/health
# → {"status":"ok","db":"ok","redis":"ok","uptime":...}
```

---

## Option B: Docker

```bash
git clone <repo-url> novastreams-panel
cd novastreams-panel
cp .env.example .env
# Edit .env with real secrets (replace ALL change_me_* values)

docker compose up -d

# Check health
curl http://localhost:3000/health
```

The compose file starts `panel`, `mariadb`, and `redis`. Database bootstrap runs automatically on first start.

**Important:** Replace ALL `change_me_*` values in your environment before running. The server checks that secrets are set but does not validate strength.

---

## Option C: Automated Script

```bash
bash install.sh
```

The script:
- Generates random secrets with `openssl`
- Creates `.env` with 640 permissions
- Creates MariaDB database and user
- Runs `npm run bootstrap-db`
- Starts with PM2
- Saves credentials to `.install-credentials.txt`

---

## Quick Start (Development)

```bash
git clone <repo-url> novastreams-panel
cd novastreams-panel
npm install
cp .env.example .env
# Edit .env with local values
npm run bootstrap-db
npm run dev          # Node.js watch (terminal 1)
npm run dev:vite     # Vite HMR (terminal 2)
```

---

## Verify FFmpeg

```bash
npm run verify:preset
```

---

## Troubleshooting

| Problem | Check |
|---|---|
| Server won't start | All required env vars set? Check `logs/` for error |
| `SESSION_SECRET` error | Must be set — server hard-fails without it |
| `LINE_PASSWORD_SECRET` error | Must be set — line password ops crash without it |
| No streams play | `STREAM_SECRET` must be set; check FFmpeg installation |
| Database connection fails | MariaDB running? Credentials correct? DB exists? |
| Redis connection fails | `redis-cli ping` should return `PONG` |
| Frontend blank page | Run `npm run build:frontend`; check browser console |
| Nginx 502 | Node not running on PORT 3000; check `pm2 status` |
| `/health` returns 503 | MariaDB or Redis unreachable; check both services |
| Session not persisting | Redis must be running — sessions are server-side |
