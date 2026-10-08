#!/usr/bin/env bash
# After WinSCP upload. Run SQLyog 022 (and 021 if not yet applied) first.
set -euo pipefail
APP_DIR="${1:-.}"
cd "$APP_DIR"
if [ ! -d src ] || [ ! -f package.json ]; then
  echo "ERROR: not the app root (missing src/ or package.json)."
  echo "You may have uploaded into a nested 04-winscp-... folder."
  exit 1
fi
if [ ! -f src/lib/workflow-schedule.ts ]; then
  echo "ERROR: src/lib/workflow-schedule.ts missing — upload incomplete."
  exit 1
fi
if [ ! -f src/types/database.ts ]; then
  echo "ERROR: src/types/database.ts missing — upload incomplete."
  exit 1
fi
if [ ! -f src/app/api/workflows/inspect/route.ts ]; then
  echo "ERROR: inspect API route missing — upload incomplete."
  exit 1
fi
echo "==> Building"
npm run build
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart data-quality-tool || pm2 restart all
fi
echo "Done"