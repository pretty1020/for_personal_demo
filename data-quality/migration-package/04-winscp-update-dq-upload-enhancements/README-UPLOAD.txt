WinSCP - Data Quality upload enhancements
=========================================

Does NOT change Capacity.

Features in this package:
  - Duplicate filename -> Overwrite or Append/Merge
  - Required dynamic YYYYMMDD in filename (period vs schedule)
  - SharePoint link path on workflow create/edit
  - Upload to SharePoint button on passed files
  - Public / Private visibility (private hides preview)
  - Dashboard / charts polish + Last upload column
  - Soft SQL defaults for require_yyyymmdd + visibility

------------------------------------------------------------
IMPORTANT - how to upload (avoids common WinSCP mistakes)
------------------------------------------------------------
  YES: Open this folder, then upload these TWO items into the app root:
       src/
       database/

  YES: Overwrite when WinSCP asks.
  YES: Transfer mode = Binary (Transfer settings).

  NO: Do NOT upload this whole package as a nested folder
      (server must NOT get .../04-winscp-update-dq-upload-enhancements/src)

  NO: Do NOT upload:
       README-UPLOAD.txt
       _sqlyog-do-not-upload/
       server-commands.sh

  Paths with (main) and [id] are normal Next.js folders - keep those names.
  After upload, confirm these exist on the server (brackets often get skipped):
    src/app/(main)/intake/page.tsx
    src/app/(main)/files/[id]/page.tsx
    src/app/(main)/workflows/[id]/edit/page.tsx
    src/app/api/files/[id]/route.ts
    src/app/api/workflows/[id]/route.ts
    src/lib/filename-period.ts
    src/lib/file-merge.ts
    src/lib/file-visibility.ts

------------------------------------------------------------
1) SQLyog FIRST
------------------------------------------------------------
  Run:
       _sqlyog-do-not-upload/023_dq_upload_enhancements.sql

  Also under database/mariadb/ after WinSCP (same script).

  Confirm:
    USE mis_ph_db;
    SELECT JSON_EXTRACT(pass_rules, '$.require_yyyymmdd') FROM workflows LIMIT 5;
    SELECT JSON_EXTRACT(metadata, '$.visibility') FROM files LIMIT 5;

  Notes:
  - SharePoint URL / owners / frequency stay in pass_rules JSON.
  - Visibility / period_yyyymmdd stay in files.metadata JSON.
  - 023 soft-defaults missing keys only; skips if tables/columns missing
    or a row has invalid JSON. Does not alter Capacity tables.
  - App still works if 023 is delayed (defaults are also enforced in code).

------------------------------------------------------------
2) WinSCP - merge into app root
------------------------------------------------------------
  Local:  migration-package/04-winscp-update-dq-upload-enhancements/
  Remote: /var/www/Data_Quality_Tool   (or your app root)

  After upload you should have (examples):
    .../src/lib/filename-period.ts
    .../src/lib/file-merge.ts
    .../src/lib/file-visibility.ts
    .../src/app/api/files/upload/route.ts
    .../src/app/(main)/intake/page.tsx
    .../src/app/(main)/files/[id]/page.tsx
    .../src/app/(main)/dashboard/page.tsx
    .../database/mariadb/023_dq_upload_enhancements.sql

------------------------------------------------------------
3) PuTTY - rebuild and restart
------------------------------------------------------------
  cd /var/www/Data_Quality_Tool
  npm run build
  pm2 restart data-quality-tool

  Or: bash server-commands.sh /var/www/Data_Quality_Tool

  If build fails with "Cannot find module" / nested path:
  you uploaded into a nested folder - fix paths and rebuild.

  If build fails on xlsx / file-merge:
  ensure package.json already includes "xlsx" (from the full DQ deploy).
  Run: npm install

------------------------------------------------------------
4) Verify
------------------------------------------------------------
  Intake: Public/Private + YYYYMMDD required + overwrite/append dialog
  Workflows -> New/Edit: SharePoint link + require YYYYMMDD
  File detail (processed): Upload to SharePoint
  File detail / Reports: Private hides preview
  Dashboard: Client / Data owner filters; Last upload; YYYYMMDD period status (no date-filter fallback on schedule)
  Capacity unchanged

------------------------------------------------------------
Prerequisite
------------------------------------------------------------
  Earlier DQ packages recommended:
    04-winscp-update-dq-auth
    04-winscp-update-dq-workflow-dashboard
    04-winscp-update-dq-schedule
