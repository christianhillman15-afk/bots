#!/usr/bin/env bash
#
# One-shot setup for Launch Media Prospector on a fresh DigitalOcean Droplet
# (Ubuntu 22.04 / 24.04). Installs Node, installs the app, writes config,
# and runs it 24/7 under systemd (auto-restart + start-on-boot).
#
# It reads its config from environment variables so NO secrets live in this
# file. Set them before running (the bootstrap commands in the guide do this):
#
#   PLACES_KEY   = your Google Places API key            (required for live data)
#   DASH_PASS    = the dashboard login password          (required)
#   PAGESPEED_KEY= your PageSpeed key                     (optional)
#   APP_PORT     = port to listen on                      (default 4317)
#
# Re-running it updates the app: it pulls latest code, reinstalls, restarts.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # .../prospector
PORT="${APP_PORT:-4317}"
SERVICE=launch-media-prospector

echo "==> Launch Media Prospector setup (app dir: $APP_DIR, port: $PORT)"

if [ -z "${DASH_PASS:-}" ]; then
  echo "!! DASH_PASS is not set — refusing to deploy an unprotected dashboard."
  echo "   Re-run with:  export DASH_PASS='something-strong'  then run again."
  exit 1
fi

# --- 1. Node.js 20 (only if missing or too old) ----------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "==> Node $(node -v)"

# --- 2. App dependencies ----------------------------------------------------
echo "==> Installing app dependencies..."
cd "$APP_DIR"
# refresh code if this is a re-run inside a git checkout
if git -C "$APP_DIR/.." rev-parse >/dev/null 2>&1; then
  git -C "$APP_DIR/.." pull --ff-only || true
fi
npm install --omit=dev

# --- 3. Config (.env) -------------------------------------------------------
echo "==> Writing .env..."
DATA_DIR="$APP_DIR/data"
mkdir -p "$DATA_DIR"
umask 077
cat > "$APP_DIR/.env" <<EOF
GOOGLE_PLACES_API_KEY=${PLACES_KEY:-}
PAGESPEED_API_KEY=${PAGESPEED_KEY:-}
GEMINI_API_KEY=${GEMINI_KEY:-}
DASHBOARD_PASSWORD=${DASH_PASS}
PORT=${PORT}
DATA_DIR=${DATA_DIR}
AUDIT_MODE=light
AUTO_SCAN=true
AUTO_ENRICH=true
# Special Requests enrichment (optional; blank = feature just uses Gemini + scraping)
GOOGLE_CSE_API_KEY=${GOOGLE_CSE_KEY:-}
GOOGLE_CSE_CX=${GOOGLE_CSE_CX:-}
CRUNCHBASE_API_KEY=${CRUNCHBASE_KEY:-}
EDGAR_ENABLED=${EDGAR_ENABLED:-false}
TWILIO_ACCOUNT_SID=${TWILIO_ACCOUNT_SID:-}
TWILIO_AUTH_TOKEN=${TWILIO_AUTH_TOKEN:-}
APOLLO_API_KEY=${APOLLO_API_KEY:-}
EOF
umask 022

# --- 4. systemd service (24/7, auto-restart, start on boot) -----------------
echo "==> Installing systemd service..."
NODE_BIN="$(command -v node)"
cat > /etc/systemd/system/${SERVICE}.service <<EOF
[Unit]
Description=Launch Media Prospector lead finder
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/bin/prospector.js serve
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE}" >/dev/null 2>&1 || true
systemctl restart "${SERVICE}"

# --- 5. Done ----------------------------------------------------------------
IP="$(curl -s --max-time 4 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || curl -s --max-time 4 ifconfig.me || echo YOUR_DROPLET_IP)"
sleep 2
echo
echo "============================================================"
echo " ✅ Launch Media Prospector is running."
echo "    Open:     http://${IP}:${PORT}"
echo "    Login:    just your dashboard password"
echo "    Logs:     journalctl -u ${SERVICE} -f"
echo "    Restart:  systemctl restart ${SERVICE}"
echo "============================================================"
systemctl --no-pager status "${SERVICE}" | head -n 6 || true
