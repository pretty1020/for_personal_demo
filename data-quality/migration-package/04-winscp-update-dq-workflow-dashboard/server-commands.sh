#!/usr/bin/env bash
# Run on the app server after WinSCP upload (PuTTY / SSH).
# Usage:
#   bash server-commands.sh /var/www/Data_Quality_Tool
#
# Before this: run SQLyog 021_workflow_client_name.sql

set -euo pipefail

APP_DIR="${1:-.}"
cd "$APP_DIR"

echo "==> Node version"
node -v

if [ ! -d src ] || [ ! -f package.json ]; then
  echo "ERROR: This does not look like the app root (missing src/ or package.json)."
  echo "You may have uploaded into a nested 04-winscp-... folder. Fix paths and retry."
  exit 1
fi

if [ ! -f src/types/database.ts ]; then
  echo "ERROR: src/types/database.ts missing â€” WinSCP upload incomplete."
  exit 1
fi

echo "==> Building"
npm run build

echo "==> Restarting"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart data-quality-tool || pm2 restart all
else
  echo "pm2 not found â€” restart your process manager manually."
fi

echo "==> Done"
