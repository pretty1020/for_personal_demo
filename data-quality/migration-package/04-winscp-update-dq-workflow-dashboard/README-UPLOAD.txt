WinSCP — Data Quality workflow / Dashboard update
=================================================

Does NOT change Capacity. DQ only.

------------------------------------------------------------
IMPORTANT — how to upload (avoids common WinSCP mistakes)
------------------------------------------------------------
  ✅ Open this folder, then upload these TWO items into the app root:
       src/
       database/

  ✅ Overwrite existing files when WinSCP asks.

  ❌ Do NOT upload this whole package folder as a nested directory
     (server must NOT get .../04-winscp-update-dq-workflow-dashboard/src)

  ❌ Do NOT upload:
       README-UPLOAD.txt
       _sqlyog-do-not-upload/
       server-commands.sh   (optional — run manually in PuTTY instead)

  Paths with (main) and [id] are normal Next.js folders — keep those names.

------------------------------------------------------------
1) SQLyog FIRST (required for dedicated client_name column)
------------------------------------------------------------
  Run (from this package):
    _sqlyog-do-not-upload/021_workflow_client_name.sql

  Or from the main repo:
    migration-package/01-sqlyog/021_workflow_client_name.sql
    database/mariadb/021_workflow_client_name.sql

  Confirm:
    USE mis_ph_db;
    SHOW COLUMNS FROM workflows LIKE 'client_name';

  Note: the app also stores client_name inside pass_rules, so create/edit
  still works if 021 is delayed — but run 021 so the column exists.

------------------------------------------------------------
2) WinSCP — merge into app root
------------------------------------------------------------
  Local:  migration-package/04-winscp-update-dq-workflow-dashboard/
  Remote: /var/www/Data_Quality_Tool   (or your app root)

  After upload you should have (examples):
    .../src/types/database.ts
    .../src/lib/mariadb/repository.ts
    .../src/app/(main)/dashboard/page.tsx
    .../src/app/api/files/[id]/route.ts
    .../database/mariadb/021_workflow_client_name.sql

------------------------------------------------------------
3) PuTTY — rebuild and restart
------------------------------------------------------------
  cd /var/www/Data_Quality_Tool
  npm run build
  pm2 restart data-quality-tool

  Or: bash server-commands.sh /var/www/Data_Quality_Tool

  If build fails with "Unknown file extension" / missing module, you
  likely uploaded into a nested folder — fix paths and rebuild.

------------------------------------------------------------
4) Verify
------------------------------------------------------------
  Workflows → New: Client name, Filename pattern, Audit rules
  Intake → Scan folder (non-Vercel)
  File detail → Delete file
  Dashboard → Client column + charts
  Capacity unchanged

------------------------------------------------------------
Prerequisite
------------------------------------------------------------
  If DQ login / workflows table missing, deploy
  04-winscp-update-dq-auth first.
