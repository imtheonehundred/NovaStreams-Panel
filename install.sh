#!/usr/bin/env bash
#
# NovaStreams Panel — One-Command Installer
# Tested on: Ubuntu 22.04 LTS, 24.04 LTS
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/imtheonehundred/NovaStreams-Panel/main/install.sh | bash
#
# Or download and run locally:
#   chmod +x install.sh && ./install.sh
#

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
BYN='\033[0;36m'
RST='\033[0m'

info()    { echo -e "${BYN}[INFO]${RST} $*"; }
ok()      { echo -e "${GRN}[ OK ]${RST} $*"; }
warn()    { echo -e "${YLW}[WARN]${RST} $*"; }
die()     { echo -e "${RED}[FAIL]${RST} $*" >&2; exit 1; }

SCRIPT_URL="${INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/imtheonehundred/NovaStreams-Panel/main/install.sh}"
PANEL_DIR="${PANEL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)}"

# Allow override via env
ADMIN_USER="${INSTALL_ADMIN_USER:-admin}"
ADMIN_PASS="${INSTALL_ADMIN_PASSWORD:-}"
DB_NAME="${DB_NAME:-iptv_panel}"
DB_USER="${DB_USER:-iptv}"
DB_HOST="${DB_HOST:-127.0.0.1}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

# ── Detect if running as installer vs being fetched ──────────────────────────
# If PANEL_DIR is empty or is a temp path, we're being curl'd — find or create panel dir
if [[ -z "$PANEL_DIR" ]] || [[ "$PANEL_DIR" == /tmp* ]] || [[ ! -f "$PANEL_DIR/package.json" ]]; then
    PANEL_DIR="/opt/novastreams-panel"
fi

# ── Pre-flight ──────────────────────────────────────────────────────────────
if [[ "$EUID" -eq 0 ]]; then
    warn "Running as root — will use sudo for system commands"
    SUDO=""
else
    SUDO="sudo"
fi

if ! command -v curl &>/dev/null && ! command -v wget &>/dev/null; then
    info "Installing curl..."
    $SUDO apt-get update -qq
    $SUDO apt-get install -y curl
fi

# ── Parse flags ─────────────────────────────────────────────────────────────
INSTALL_DIR="$PANEL_DIR"
SKIP_DEP=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --dir)    INSTALL_DIR="$2"; shift 2 ;;
        --skip-deps) SKIP_DEP="1"; shift ;;
        *)        die "Unknown option: $1" ;;
    esac
done

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 1 — System dependencies
# ═══════════════════════════════════════════════════════════════════════════
if [[ -z "$SKIP_DEP" ]]; then
    info "Updating APT..."
    $SUDO apt-get update -qq

    info "Installing system dependencies..."
    $SUDO apt-get install -y \
        ca-certificates curl unzip tar xz-utils gnupg build-essential python3 \
        python3-pip git wget sudo \
        mariadb-server mariadb-client \
        redis-server \
        nginx \
        ufw || true

    ok "System dependencies installed"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 2 — Node.js
# ═══════════════════════════════════════════════════════════════════════════
if ! command -v node &>/dev/null; then
    info "Installing Node.js 20 (NodeSource)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >> /dev/null 2>&1
    $SUDO apt-get install -y nodejs
    ok "Node.js $(node -v) installed"
elif [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
    warn "Node.js version is old ( $(node -v) ), consider upgrading to Node 20+"
else
    ok "Node.js $(node -v) found"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 3 — FFmpeg
# ═══════════════════════════════════════════════════════════════════════════
if ! command -v ffmpeg &>/dev/null || ! ffmpeg -hide_banner -h demuxer=dash 2>&1 | grep -qi "cenc"; then
    info "Installing FFmpeg (BtbN master build)..."
    FFWORK="$(mktemp -d)"
    (
        cd "$FFWORK"
        curl -fsSL -o ffmpeg.tar.xz \
            https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz
        tar xf ffmpeg.tar.xz
        $SUDO cp ffmpeg-*/bin/ffmpeg ffmpeg-*/bin/ffprobe /usr/local/bin/
        $SUDO chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
    )
    rm -rf "$FFWORK"
    hash -r
    ok "FFmpeg $(ffmpeg -version | head -1) installed"
else
    ok "FFmpeg $(ffmpeg -version | head -1) found"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 4 — Panel directory
# ═══════════════════════════════════════════════════════════════════════════
if [[ ! -d "$INSTALL_DIR" ]]; then
    info "Creating panel directory: $INSTALL_DIR"
    $SUDO mkdir -p "$INSTALL_DIR"
    $SUDO cp -r "$PANEL_DIR/." "$INSTALL_DIR/" 2>/dev/null || true
fi
cd "$INSTALL_DIR"

# If we were curl'd and panel files aren't here yet, download them
if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
    info "Panel files not found locally — downloading from GitHub..."
    TEMP_ZIP="$(mktemp)"
    curl -fsL "$SCRIPT_URL" --output "$TEMP_ZIP" 2>/dev/null || \
    curl -fsL "https://github.com/imtheonehundred/NovaStreams-Panel/archive/main.tar.gz" -o "$TEMP_ZIP" 2>/dev/null || \
    die "Could not download panel. Clone the repo manually:\n  git clone https://github.com/imtheonehundred/NovaStreams-Panel.git"
    $SUDO mkdir -p "$INSTALL_DIR"
    tar xzf "$TEMP_ZIP" -C "$INSTALL_DIR" --strip-components=1 2>/dev/null || \
    unzip -q "$TEMP_ZIP" -d "$INSTALL_DIR" 2>/dev/null || true
    rm -f "$TEMP_ZIP"
fi

# ── Ensure required dirs exist ─────────────────────────────────────────────
$SUDO mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/streams" "$INSTALL_DIR/watermarks"
chmod -R 755 "$INSTALL_DIR/data" "$INSTALL_DIR/logs" "$INSTALL_DIR/streams" "$INSTALL_DIR/watermarks"

ok "Panel directory ready: $INSTALL_DIR"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 5 — MariaDB & Redis
# ═══════════════════════════════════════════════════════════════════════════
info "Configuring MariaDB and Redis..."

$SUDO systemctl enable mariadb 2>/dev/null || true
$SUDO systemctl enable redis-server 2>/dev/null || true
$SUDO systemctl start mariadb 2>/dev/null || true
$SUDO systemctl start redis-server 2>/dev/null || true

# Generate passwords if not set
if [[ -z "$DB_PASSWORD" ]]; then
    DB_PASSWORD="$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi
SESSION_SECRET="$(openssl rand -hex 48)"

info "Creating MariaDB database and user..."
$SUDO mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
$SUDO mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'${DB_HOST}' IDENTIFIED BY '${DB_PASSWORD}';"
$SUDO mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${DB_HOST}';"
$SUDO mysql -e "FLUSH PRIVILEGES;"

ok "MariaDB ready"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 6 — .env
# ═══════════════════════════════════════════════════════════════════════════
info "Writing .env configuration..."
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    $SUDO cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi

# Patch .env with generated secrets
$SUDO sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${DB_PASSWORD}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^DB_NAME=.*/DB_NAME=${DB_NAME}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^DB_USER=.*/DB_USER=${DB_USER}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^DB_HOST=.*/DB_HOST=${DB_HOST}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^REDIS_HOST=.*/REDIS_HOST=${REDIS_HOST}/" "$INSTALL_DIR/.env"
$SUDO sed -i "s/^REDIS_PORT=.*/REDIS_PORT=${REDIS_PORT}/" "$INSTALL_DIR/.env"
$SUDO chmod 640 "$INSTALL_DIR/.env"

ok ".env configured"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 7 — Database schema
# ═══════════════════════════════════════════════════════════════════════════
info "Importing database schema..."
SCHEMA="$INSTALL_DIR/scripts/schema.sql"
if [[ -f "$SCHEMA" ]]; then
    $SUDO mysql "${DB_NAME}" < "$SCHEMA" 2>/dev/null || \
    mysql -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASSWORD}" "${DB_NAME}" < "$SCHEMA" || \
    warn "Schema import skipped — run 'npm run bootstrap-db' manually"
    ok "Schema imported"
else
    warn "Schema file not found: $SCHEMA"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 8 — npm install
# ═══════════════════════════════════════════════════════════════════════════
info "Installing npm dependencies..."
cd "$INSTALL_DIR"
$SUDO chown -R "$(whoami):" "$INSTALL_DIR" 2>/dev/null || true
npm install --silent 2>&1 | tail -3

ok "Dependencies installed"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 9 — Admin user
# ═══════════════════════════════════════════════════════════════════════════
info "Creating admin user..."
cd "$INSTALL_DIR"
if [[ -n "$ADMIN_PASS" ]]; then
    INSTALL_ADMIN_PASSWORD="$ADMIN_PASS" npm run bootstrap-db 2>/dev/null | tail -5 || true
else
    # Generate random password
    ADMIN_PASS="$(openssl rand -base64 20 | tr -dc 'a-zA-Z0-9' | head -c 16)"
    INSTALL_ADMIN_PASSWORD="$ADMIN_PASS" npm run bootstrap-db 2>/dev/null | tail -5 || true
fi

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 10 — Done
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GRN}═══════════════════════════════════════════════════════════${RST}"
echo -e "${GRN}  NovaStreams Panel installed successfully!${RST}"
echo -e "${GRN}═══════════════════════════════════════════════════════════${RST}"
echo ""
echo -e "  ${BYN}Panel directory:${RST}  $INSTALL_DIR"
echo -e "  ${BYN}Admin URL:${RST}       http://localhost:3000"
echo -e "  ${BYN}Admin user:${RST}      $ADMIN_USER"
echo -e "  ${BYN}Admin password:${RST}   $ADMIN_PASS"
echo ""
echo -e "  ${YLW}IMPORANT:${RST} Save these credentials! The password"
echo -e "         cannot be recovered. Find it later in:"
echo -e "         $INSTALL_DIR/.env"
echo ""
echo -e "  ${BYN}Start the panel:${RST}"
echo -e "    cd $INSTALL_DIR && npm start"
echo ""
echo -e "${GRN}═══════════════════════════════════════════════════════════${RST}"
echo ""
