#!/usr/bin/env bash
# Full stack install on a fresh Ubuntu VPS: system deps, Node 20, FFmpeg (BtbN),
# MariaDB, Redis, database schema, .env, npm install, first admin user.
#
# Usage (from anywhere):
#   bash /path/to/NEW\ PANEL/scripts/auto_install_ubuntu.sh
#
# Optional env:
#   INSTALL_ADMIN_USER=admin
#   INSTALL_ADMIN_PASSWORD=yourSecurePassword   (otherwise random)

set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_FILE="${PANEL_DIR}/scripts/schema.sql"
ENV_EXAMPLE="${PANEL_DIR}/.env.example"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$SCHEMA_FILE" ]] || die "Missing schema: $SCHEMA_FILE"
[[ -f "${PANEL_DIR}/package.json" ]] || die "Invalid panel directory: $PANEL_DIR"

echo "==> APT: base tools + MariaDB + Redis"
sudo apt-get update
sudo apt-get install -y \
  ca-certificates curl unzip tar xz-utils gnupg build-essential python3 \
  mariadb-server mariadb-client redis-server

echo "==> Node.js 20 (NodeSource)"
if [[ ! -f /etc/apt/sources.list.d/nodesource.list ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
fi
sudo apt-get install -y nodejs
node -v
npm -v

echo "==> FFmpeg (BtbN build, matches SETUP.md)"
FFWORKDIR="$(mktemp -d)"
cleanup_ff() { rm -rf "$FFWORKDIR"; }
trap cleanup_ff EXIT
cd "$FFWORKDIR"
curl -LO https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-gpl.tar.xz
tar xf ffmpeg-master-latest-linux64-gpl.tar.xz
sudo cp ffmpeg-*/bin/ffmpeg ffmpeg-*/bin/ffprobe /usr/local/bin/
sudo chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe
hash -r
which ffmpeg
ffmpeg -version | head -n 1

echo "==> Enable & start MariaDB + Redis"
sudo systemctl enable mariadb
sudo systemctl start mariadb
sudo systemctl enable redis-server
sudo systemctl start redis-server

DB_NAME="${DB_NAME:-iptv_panel}"
DB_USER="${DB_USER:-iptv}"
DB_HOST="${DB_HOST:-localhost}"

ENV_FILE="${PANEL_DIR}/.env"
if [[ -z "${DB_PASSWORD:-}" ]] && [[ -f "$ENV_FILE" ]] && grep -qE '^DB_PASSWORD=' "$ENV_FILE"; then
  DB_PASSWORD="$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [[ -z "${DB_PASSWORD:-}" ]]; then
  DB_PASSWORD="$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)"
fi

if [[ -f "$ENV_FILE" ]] && grep -qE '^SESSION_SECRET=' "$ENV_FILE"; then
  SESSION_SECRET="$(grep -E '^SESSION_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
else
  SESSION_SECRET="$(openssl rand -hex 32)"
fi

echo "==> Create MariaDB database and user"
sudo mysql -e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql "${DB_NAME}" < "$SCHEMA_FILE"

sudo mysql -e "CREATE OR REPLACE USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
sudo mysql -e "CREATE OR REPLACE USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';"
sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
sudo mysql -e "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';"
sudo mysql -e "FLUSH PRIVILEGES;"

echo "==> Write ${PANEL_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  bak="${PANEL_DIR}/.env.bak.$(date +%Y%m%d%H%M%S)"
  echo "    (backing up existing .env to $bak)"
  cp -a "$ENV_FILE" "$bak"
else
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp -f "$ENV_EXAMPLE" "$ENV_FILE"
  else
    touch "$ENV_FILE"
  fi
fi

# Replace or append critical keys (portable: no jq required)
set_env_kv() {
  local key="$1" val="$2" file="${PANEL_DIR}/.env"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak_install "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "${file}.bak_install"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

set_env_kv "DB_HOST" "$DB_HOST"
set_env_kv "DB_PORT" "3306"
set_env_kv "DB_USER" "$DB_USER"
set_env_kv "DB_PASSWORD" "$DB_PASSWORD"
set_env_kv "DB_NAME" "$DB_NAME"
set_env_kv "REDIS_HOST" "127.0.0.1"
set_env_kv "REDIS_PORT" "6379"
set_env_kv "REDIS_PASSWORD" ""
set_env_kv "SESSION_SECRET" "$SESSION_SECRET"
set_env_kv "PORT" "${PORT:-3000}"
set_env_kv "STREAMING_MODE" "${STREAMING_MODE:-node}"

chmod 600 "${PANEL_DIR}/.env" 2>/dev/null || true

echo "==> Data directories"
mkdir -p "${PANEL_DIR}/data" "${PANEL_DIR}/logs" "${PANEL_DIR}/streams" "${PANEL_DIR}/watermarks"

echo "==> npm install"
cd "$PANEL_DIR"
npm install

CRED_FILE="${PANEL_DIR}/.install-credentials.txt"
{
  echo "IPTV Panel — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Panel directory: $PANEL_DIR"
  echo "Open: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo YOUR_IP):${PORT:-3000}"
  echo "MariaDB database: ${DB_NAME}  user: ${DB_USER}"
  echo "MariaDB password: ${DB_PASSWORD}"
  echo "Session secret stored in .env as SESSION_SECRET"
  echo "---"
  echo "Delete this file after you store credentials safely."
} > "$CRED_FILE"
chmod 600 "$CRED_FILE"

echo "==> Bootstrap DB (migrations + optional first admin)"
export INSTALL_ADMIN_USER="${INSTALL_ADMIN_USER:-admin}"
export INSTALL_CREDENTIALS_FILE="$CRED_FILE"
# Password only passed if user set INSTALL_ADMIN_PASSWORD in environment
node "${PANEL_DIR}/scripts/bootstrap-database.js"

echo ""
echo "=========================================="
echo " Install finished."
echo " Panel:    cd \"$PANEL_DIR\" && npm start"
echo " Credentials (copy): $CRED_FILE"
echo "=========================================="
