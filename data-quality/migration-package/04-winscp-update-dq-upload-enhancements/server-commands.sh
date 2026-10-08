#!/usr/bin/env bash
# After WinSCP upload. Run SQLyog 023 first (optional soft-defaults).
set -euo pipefail
APP_DIR="${1:-.}"
cd "$APP_DIR"
if [ ! -d src ] || [ ! -f package.json ]; then
  echo "ERROR: not the app root (missing src/ or package.json)."
  echo "You may have uploaded into a nested 04-winscp-... folder."
  exit 1
fi

missing=0
check() {
  if [ ! -f "$1" ]; then
    echo "ERROR: missing $1 — upload incomplete (often skipped [id] or (main) paths)."
    missing=1
  fi
}

check "src/lib/filename-period.ts"
check "src/lib/file-merge.ts"
check "src/lib/file-visibility.ts"
check "src/lib/workflow-meta.ts"
check "src/lib/workflow-schedule.ts"
check "src/lib/ingest.ts"
check "src/lib/storage.ts"
check "src/lib/dashboard-payload.ts"
check "src/lib/mariadb/repository.ts"
check "src/lib/services/workflow-scan.ts"
check "src/lib/validation/inspect-file.ts"
check "src/app/api/files/upload/route.ts"
check "src/app/api/files/[id]/route.ts"
check "src/app/api/workflows/route.ts"
check "src/app/api/workflows/[id]/route.ts"
check "src/app/api/reports/route.ts"
check "src/app/(main)/intake/page.tsx"
check "src/app/(main)/dashboard/page.tsx"
check "src/app/(main)/reports/page.tsx"
check "src/app/(main)/workflows/new/page.tsx"
check "src/app/(main)/workflows/[id]/edit/page.tsx"
check "src/app/(main)/files/[id]/page.tsx"
check "src/app/globals.css"
check "database/mariadb/023_dq_upload_enhancements.sql"

if [ "$missing" -ne 0 ]; then
  echo "Fix WinSCP upload (merge src/ and database/ into app root), then re-run."
  exit 1
fi

if ! grep -q '"xlsx"' package.json 2>/dev/null; then
  echo "WARN: package.json has no xlsx — Append/Merge may fail. Run npm install after adding xlsx."
fi

echo "==> Building"
npm run build
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart data-quality-tool || pm2 restart all
fi
echo "Done"
