#!/usr/bin/env bash
# Run on the app server after WinSCP upload (PuTTY / SSH).
# Usage:
#   cd /path/to/Data_Quality_Tool
#   bash server-commands.sh
# Or: bash server-commands.sh /path/to/Data_Quality_Tool
#
# Before this script: run SQLyog scripts
#   001 → 002 → 004 → 005 → 006 → 007 → 008 → 010 → 003
# (004 = users.is_active; 005 = Analyst access_level; 006 = capacity_clients;
#  007 = capacity_documents; 008 = audit log + shared formulas;
#  010 = read-only reporting views; 003 = demo users).
#
# 009_drop_ai_assistant_column.sql is deliberately not in that list: run it only
# after the build below is serving traffic, or the old build breaks on Add user.

set -euo pipefail

APP_DIR="${1:-.}"
cd "$APP_DIR"

echo "==> Node version (need 22.x)"
node -v

echo "==> Creating .env.local if missing"
if [ ! -f .env.local ]; then
  if [ -f .env.production.example ]; then
    cp .env.production.example .env.local
    echo "Created .env.local from .env.production.example — EDIT credentials now."
  else
    echo "Missing .env.production.example — create .env.local manually."
    echo "Do not use .env.example for production (it defaults STANDALONE=true)."
    exit 1
  fi
  echo "Required: STANDALONE=false DATA_BACKEND=mariadb DB_HOST DB_NAME=mis_ph_db DB_USER DB_PASSWORD"
  echo "HTTP deploy: COOKIE_SECURE=false   HTTPS deploy: COOKIE_SECURE=true"
fi

# Guard against accidental JSON / standalone mode on the server
if grep -Eq '^[[:space:]]*STANDALONE[[:space:]]*=[[:space:]]*true' .env.local 2>/dev/null; then
  echo "WARNING: .env.local has STANDALONE=true — Capacity will not use MariaDB."
  echo "         Set STANDALONE=false and DATA_BACKEND=mariadb for production."
fi

echo "==> data/ permissions"
mkdir -p data/uploads data/processed data/watch data/standalone
chmod -R u+rwX data || true

echo "==> npm install (root)"
npm install

# The Capacity embed under public/capacity/ is already built and uploaded, so
# capacity's own build tools (vite) are not installed here. The build step
# detects that and reuses the prebuilt embed. Installing them would only add a
# slow, failure-prone step on the server.

echo "==> production build (Next.js, reusing the prebuilt Capacity embed)"
npm run build

echo "==> ready to start (binds 0.0.0.0:3000)"
echo "  npm run start"
echo "  # or: pm2 start npm --name data-quality-tool -- start"
echo "  # open http://<server-ip>:3000"
echo "  # smoke: curl -s http://127.0.0.1:3000/api/capacity/health"
