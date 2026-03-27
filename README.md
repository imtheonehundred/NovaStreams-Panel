# NovaStreams Panel

**Open-source IPTV Restream Panel** — MPD/HLS/RTMP → HLS with sub-second startup for on-demand channels.

Built for modern IPTV workflows: live channels, VOD, on-demand streams, transcoding, reseller management, and real-time monitoring — all in one self-hosted panel.

---

## Table of Contents

- [Overview](#overview)
- [Features](#-features)
- [Technology Stack](#technology-stack)
- [Requirements](#server-requirements)
- [Quick Install](#-quick-install)
- [Service Management](#-service-management)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Streaming Optimization](#streaming-optimization)
- [Known Limitations](#-known-limitations)
- [License](#-license)

---

## Overview

NovaStreams Panel is a modern, open-source IPTV platform inspired by Xtream Codes. It ingests live MPD/DASH/HLS/RTMP streams and serves them to end users via HLS with maximum playback speed.

**What makes it different:**
- **On-demand channels as fast as live** — sub-3-second cold-start via async FFmpeg spawning, 20ms polling, and WebSocket status push
- **Modern tech stack** — Node.js, MariaDB, Redis, FFmpeg
- **Reseller + Admin panels** — full XC-style dashboard with real-time stats
- **Self-hosted, no license checks** — 100% free, runs on any VPS

---

## Features

### Streaming
- **Live channels** — MPD/DASH/HLS/RTMP ingestion, passthrough or transcode to HLS
- **On-demand channels** — starts on first viewer, now optimized for sub-3s cold start
- **VOD / Movies & Series** — direct MP4/MKV proxy, no HLS overhead
- **Transcoding** — per-channel output quality control, GPU support (NVENC, QSV, AMF, VideoToolbox)
- **Watermarks** — per-channel PNG overlays with position and opacity control
- **Multi-bitrate ABR** — 360p/480p/720p/1080p adaptive streaming
- **EPG import** — XMLTV support

### Management
- **Admin Panel** — full dashboard, channel management, server provisioning
- **Reseller Panel** — self-contained, create/delete lines, credit management
- **Real-time dashboard** — WebSocket-driven, live CPU/Network/Connections stats
- **User / Line management** — credits, bouquets, expiry, active connections
- **On-demand idle kill** — configurable, now extended to 60s for better viewer experience

### Security
- **Playback token signing** — time-limited, prevents URL sharing
- **IP sharing detection** — flags concurrent accounts
- **Rate limiting** — stream endpoints, auth endpoints, admin API
- **Helmet.js** — security headers
- **Cookie-session auth** — with brute-force protection

---

## Technology Stack

| Component | Version | Description |
|-----------|---------|-------------|
| **Node.js** | 20+ | Backend runtime |
| **Express** | 4.x | HTTP server & routing |
| **FFmpeg** | BtbN build | Media transcoding & processing |
| **MariaDB** | 11.x | SQL database engine |
| **Redis** | 7.x | Cache & session storage |
| **hls.js** | latest | Client-side HLS playback |
| **systeminformation** | 5.x | Server metrics collection |
| **ws** | 8.x | WebSocket server |

---

## Server Requirements

### Minimum Specs

| Component | Recommendation |
|-----------|----------------|
| **CPU** | 6+ cores (Xeon / Ryzen) |
| **RAM** | 16–32 GB |
| **Disk** | SSD/NVMe, 480+ GB |
| **Network** | Dedicated 1 Gbps port |
| **OS** | Ubuntu 22.04 LTS (clean install) |

### Sizing Formula

```
Bandwidth (Mbps) = Channels × Bitrate
Max Users = Bandwidth ÷ Stream Bitrate
```

Example: HD bitrate = 4 Mbps, 1 Gbps = ~940 usable Mbps
- Max Channels: 940 ÷ 4 = ~235
- Max Users: 940 ÷ 4 = ~235

> Note: 10 users watching the same channel = 10× bandwidth unless multicast/caching is used.

### RAM & CPU

| Resource | Per Stream |
|----------|-----------|
| RAM | 50–100 MB |
| CPU (transcoded) | ~1 core |

---

## Quick Install

Requires **Ubuntu 22.04 or newer** on a clean VPS.

### One-command install

```bash
curl -sL https://raw.githubusercontent.com/imtheonehundred/NovaStreams-Panel/main/install.sh | bash
```

### Manual install

```bash
# 1. Update system
sudo apt update && sudo apt full-upgrade -y

# 2. Install dependencies
sudo apt install -y python3-pip unzip curl git

# 3. Clone / download the panel
git clone https://github.com/imtheonehundred/NovaStreams-Panel.git
cd NovaStreams-Panel

# 4. Run installer
bash install.sh
```

The installer will:
- Install Node.js 20 (NodeSource)
- Install FFmpeg (BtbN master build)
- Install & configure MariaDB + Redis
- Create the database and import schema
- Generate secure secrets
- Install npm dependencies
- Create the first admin user

### Start the panel

```bash
cd NovaStreams-PPanel
npm start
```

Open `http://YOUR_SERVER_IP:3000` in your browser.

**Default admin credentials** are printed at the end of the install script. If you lose them, reset via:

```bash
npm run bootstrap-db
```

---

## Service Management

```bash
# Start
npm start

# Development (with auto-reload — requires nodemon)
npm run dev

# Stop (Ctrl+C or kill the process)

# PM2 production (recommended)
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Project Structure

```
NovaStreams-Panel/
├── server.js              # Main Node.js entry point
├── package.json            # Dependencies
├── .env.example            # Environment config template
├── install.sh              # One-command installer
├── README.md               # This file
├── config/
│   └── constants.js         # All magic numbers centralized
├── lib/
│   ├── ffmpeg-args.js      # FFmpeg command builder
│   ├── streaming-settings.js # Streaming defaults & overrides
│   ├── on-demand-live.js   # On-demand channel lifecycle
│   ├── ts-prebuffer.js     # MPEG-TS ring buffer
│   ├── hls-delay-playlist.js # Delayed HLS playlist rewriting
│   ├── db.js               # Database API (SQLite)
│   └── mariadb.js           # MariaDB/MySQL API
├── routes/
│   ├── admin.js             # Admin API endpoints
│   ├── reseller.js          # Reseller API endpoints
│   └── stream.js            # Stream playback routes
├── services/
│   ├── streamManager.js     # FFmpeg lifecycle & auto-recovery
│   ├── wsServer.js          # WebSocket real-time dashboard
│   ├── eventBus.js         # EventEmitter for stream lifecycle
│   └── ...
├── public/
│   ├── index.html           # Admin panel
│   ├── reseller.html        # Reseller panel
│   ├── css/
│   │   ├── style.css        # Base styles
│   │   └── premium.css      # Dashboard / SaaS styles
│   └── js/
│       ├── app.js           # Admin panel JavaScript
│       └── reseller-app.js  # Reseller panel JavaScript
├── scripts/
│   ├── auto_install_ubuntu.sh # Full automated install
│   ├── bootstrap-database.js  # DB schema + admin user
│   └── schema.sql           # Database schema
└── deploy/
    └── nginx-iptv.conf     # Nginx reverse-proxy config
```

---

## Configuration

### .env (copy from `.env.example`)

```bash
cp .env.example .env
nano .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Panel HTTP port |
| `DB_HOST` | `127.0.0.1` | MariaDB host |
| `DB_NAME` | `iptv_panel` | Database name |
| `SESSION_SECRET` | *(random)* | Session signing key |
| `STREAMING_MODE` | `node` | `node` or `nginx` |
| `PUBLIC_STREAM_BASE_URL` | — | Public URL for playback URLs |
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PASSWORD` | — | Redis password (optional) |

---

## Streaming Optimization

NovaStreams Panel is tuned for **maximum playback startup speed**.

### What's optimized (v1.0+)

| Setting | Default | Optimized | Effect |
|---------|---------|-----------|--------|
| HLS segment duration | 4s | **2s** | First frame in ~2s instead of ~4s |
| HLS.js max buffer | 30s | **8s** | Starts playback before filling 30s buffer |
| HLS.js low-latency mode | off | **on** | LL-HLS for sub-3s end-to-end latency |
| On-demand prebuffer min | 2MB | **256KB** | Near-instant prebuffer on broadband |
| On-demand prebuffer max wait | 3s | **500ms** | Max wait before serving reduced |
| Server poll interval | 100ms | **20ms** | 5× faster running-status detection |
| Client poll interval | 500ms | **200ms** | 2.5× faster UI refresh |
| On-demand idle kill | 30s | **60s** | More time before channel is killed |
| WebSocket push | — | **on** | `stream:running` event eliminates polling |

### On-demand cold-start timeline

```
Before: ~10-12 seconds
  └─ preDetectSource HTTP fetch (3.5s) → FFmpeg probe (5s) → hls_time (2s)

After: ~4-6 seconds
  └─ preDetectSource runs in parallel with FFmpeg → hls_time (2s) → ~20ms poll → stream:running WS event
```

### VOD / Movies & Series

Direct MP4/MKV proxy — **no HLS, no transcoding**. Uses Range header seeking. Should start near-instantly if source bandwidth allows.

---

## Known Limitations

- Requires Linux knowledge to operate
- Ubuntu 20.04 support is community-only (EOL packages)
- Transcoding module has some edge-case bugs (actively fixed)
- Community-based support via GitHub Issues

---

## License

**AGPL v3.0** — see [LICENSE](LICENSE) file.

---

## Legal Disclaimer

This software is for **educational and personal use** only. You are solely responsible for how it is used. The authors take no responsibility for misuse or illegal deployments.
