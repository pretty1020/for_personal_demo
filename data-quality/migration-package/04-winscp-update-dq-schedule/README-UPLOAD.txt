WinSCP — Data Quality schedule / Create Workflow / Dashboard
============================================================

Does NOT change Capacity.

------------------------------------------------------------
IMPORTANT — how to upload (avoids common WinSCP mistakes)
------------------------------------------------------------
  ✅ Open this folder, then upload these TWO items into the app root:
       src/
       database/

  ✅ Overwrite when WinSCP asks.

  ❌ Do NOT upload this whole package as a nested folder
     (server must NOT get .../04-winscp-update-dq-schedule/src)

  ❌ Do NOT upload:
       README-UPLOAD.txt
       _sqlyog-do-not-upload/
       server-commands.sh

  Paths with (main) and [id] are normal Next.js folders — keep those names.

------------------------------------------------------------
1) SQLyog FIRST
------------------------------------------------------------
  A) If not yet applied (client name feature):
       _sqlyog-do-not-upload/021_workflow_client_name.sql

  B) Always for this package:
       _sqlyog-do-not-upload/022_workflow_schedule_meta.sql

  Also under database/mariadb/ after WinSCP (same scripts).

  Confirm:
    USE mis_ph_db;
    SHOW TABLES LIKE 'workflows';
    SHOW COLUMNS FROM workflows LIKE 'client_name';
    SHOW COLUMNS FROM workflows LIKE 'upload_frequency';

  Note: frequency / owners / allow_duplicates are stored in pass_rules JSON.
  Columns from 022 are optional; the app still works if 022 is delayed.
  022 will skip cleanly if workflows is missing (run 001/018 first).

------------------------------------------------------------
2) WinSCP — merge into app root
------------------------------------------------------------
  Local:  migration-package/04-winscp-update-dq-schedule/
  Remote: /var/www/Data_Quality_Tool   (or your app root)

  After upload you should have (examples):
    .../src/types/database.ts
    .../src/lib/workflow-schedule.ts
    .../src/lib/workflow-meta.ts
    .../src/app/api/workflows/inspect/route.ts
    .../src/app/(main)/dashboard/page.tsx
    .../src/app/(main)/workflows/new/page.tsx
    .../database/mariadb/022_workflow_schedule_meta.sql

------------------------------------------------------------
3) PuTTY — rebuild and restart
------------------------------------------------------------
  cd /var/www/Data_Quality_Tool
  npm run build
  pm2 restart data-quality-tool

  Or: bash server-commands.sh /var/www/Data_Quality_Tool

  If build fails with missing module / nested path:
  you uploaded into a nested folder — fix paths and rebuild.

------------------------------------------------------------
4) Verify
------------------------------------------------------------
  Workflows → New: frequency, owners, allow duplicates, sample file detect
  Intake: duplicates allowed when enabled on the workflow
  Dashboard: schedule report + alert banner
  Capacity unchanged

------------------------------------------------------------
Prerequisite
------------------------------------------------------------
  workflows table + DQ login should already exist
  (earlier packages: 04-winscp-update-dq-auth and/or
   04-winscp-update-dq-workflow-dashboard).
