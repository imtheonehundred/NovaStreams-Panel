# Restream Panel — simple setup (Ubuntu VPS)

## 1) Install Node.js + tools

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl unzip tar xz-utils gnupg build-essential python3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

**Full automated install (fresh Ubuntu VPS):** from the `NEW PANEL` directory, run `bash scripts/auto_install_ubuntu.sh`. It installs APT dependencies, Node 20, the BtbN FFmpeg build (same as §2 below), **MariaDB** and **Redis**, creates the database and imports `scripts/schema.sql`, writes `.env` (DB/Redis/session secrets), runs `npm install`, runs `npm run bootstrap-db` (migrations + first **admin** user if the DB is empty), and writes `.install-credentials.txt` with DB and access hints. Then start the panel with `npm start`. Optional: set `INSTALL_ADMIN_USER` / `INSTALL_ADMIN_PASSWORD` before running the script; otherwise a random admin password is printed by the bootstrap step.

## 2) Install FFmpeg (BtbN build, recommended)

```bash
cd /tmp
curl -LO https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz
tar xf ffmpeg-master-latest-linux64-gpl.tar.xz
sudo cp ffmpeg-*/bin/ffmpeg ffmpeg-*/bin/ffprobe /usr/local/bin/
sudo chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
hash -r
which ffmpeg
ffmpeg -version
ffmpeg -hide_banner -h demuxer=dash | grep -Ei "cenc|decrypt"
ffmpeg -hide_banner -h demuxer=mov  | grep -Ei "cenc|decrypt"
```

If `which ffmpeg` is not `/usr/local/bin/ffmpeg`, run:

```bash
sudo apt remove -y ffmpeg
hash -r
which ffmpeg
```

## 3) Upload and unzip project

```bash
mkdir -p ~/restream-panel
cd ~
unzip -o restream-panel-dist.zip -d restream-panel
cd restream-panel
```

## 4) Configure and install app

```bash
cp -n .env.example .env
mkdir -p data logs streams watermarks
npm install
```

Optional: set a strong session key:

```bash
openssl rand -hex 32
```

Put it in `.env` as `SESSION_SECRET=...`

## 5) Run panel

Run the app **from the `NEW PANEL` directory** (this repo’s `server.js` + `routes/admin.js`). Do **not** use the legacy `webapp/` tree as the Node entrypoint for the admin UI: that older `server.js` does not mount `/api/admin`, so the panel will show errors like `Cannot GET /api/admin/servers` and `Cannot GET /api/admin/servers/nginx-export` (HTML 404) instead of JSON.

```bash
cd NEW PANEL   # or the path where you unpacked this app
npm install
npm start
```

Default `PORT` is **3000** (see `process.env.PORT`). Open the URL that matches the port your browser uses (e.g. `http://localhost:3000` or `http://YOUR_VPS_IP:3000`). If you put the panel behind Nginx on port 80/443, **proxy `/api` to the same Node process** so the UI still calls `/api/admin/...` on the same host you load in the browser.

Open:

- local: `http://localhost:3000`
- VPS: `http://YOUR_VPS_IP:3000`

### Verify admin API (no login required for this check)

When logged out, these should return **401** with **`Content-Type: application/json`** and `{"error":"unauthorized"}`. If you see **HTML** with `Cannot GET /api/admin/...`, the request is not reaching the **NEW PANEL** `server.js` (wrong app, wrong port, or static-only server).

```bash
curl -s -i http://127.0.0.1:3000/api/admin/servers
curl -s -i http://127.0.0.1:3000/api/admin/servers/nginx-export
```

Replace `3000` with your `PORT` if different.

### SSH load-balancer provisioning

Set **`ENABLE_SERVER_PROVISIONING=1`** in `.env` (master switch), then in the panel go to **Settings → Streaming → Enable Server Provisioning** to store `streaming_provisioning_enabled` in the database. If the env switch is off, provisioning stays disabled regardless of the UI. Remote installs also require **`AGENT_SECRET`** in `.env`.

## Quick checks

```bash
which ffmpeg
ffmpeg -hide_banner -h demuxer=dash | grep -Ei "cenc|decrypt|decryption"
ffmpeg -hide_banner -h demuxer=mov  | grep -Ei "cenc|decrypt|decryption"
```

If frame count increases in logs (`frame=...`), stream is running correctly.
