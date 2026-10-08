WinSCP — Data Quality login (separate from Capacity)
=====================================================

YES — you need a WinSCP upload for this feature (plus SQLyog for 017).

This package does NOT change Capacity. Capacity login stays independent.

------------------------------------------------------------
1) SQLyog (database) — do this first
------------------------------------------------------------
  A) Always run (DQ login):
       017_dq_auth.sql

  B) If Dashboard shows "Table 'mis_ph_db.workflows' doesn't exist":
       018_ensure_dq_core_tables.sql
     (creates workflows, files, and other DQ core tables; safe IF NOT EXISTS)

  C) Only if 018 fails with errno 150 (FK incorrectly formed):
       001b_rebuild_dq_core_tables.sql
     (DROPS and recreates DQ core tables — Capacity untouched)

  Seed admin after 017:
    email:    dq.admin@movate.com
    password: DqAdmin!2026
  Change the password after first login.

  Confirm in SQLyog:
    USE mis_ph_db;
    SHOW TABLES LIKE 'workflows';
    SHOW TABLES LIKE 'files';
    SHOW TABLES LIKE 'dq_users';
------------------------------------------------------------
2) WinSCP — upload CONTENTS of this folder to the app root
------------------------------------------------------------
  Folder: migration-package/04-winscp-update-dq-auth/

  Upload so that on the server you get:
    /src/lib/dq-auth.ts
    /src/lib/api-guard.ts
    /src/components/...
    /src/app/login/...
    /src/app/(main)/...
    /src/app/api/dq-auth/...
    /src/app/api/dq-users/...
    /src/app/api/dashboard/route.ts   (and other patched DQ APIs)
    /database/mariadb/017_dq_auth.sql

  Do NOT upload into a nested 04-winscp-... folder on the server —
  merge into the existing app root (same paths as local).

------------------------------------------------------------
3) PuTTY — rebuild and restart
------------------------------------------------------------
  npm run build
  pm2 restart data-quality-tool
  (use your usual process name if different)

------------------------------------------------------------
4) Verify
------------------------------------------------------------
  Open the site → you should see Data Quality sign in (/login)
  Sign in with the seed admin
  Dashboard should load without "workflows doesn't exist"
  Settings → Data Quality users → grant access to other users
  Capacity (/capacity) still uses Capacity’s own login

------------------------------------------------------------
What this package includes
------------------------------------------------------------
  - New: DQ auth lib, login page, session APIs, user admin UI
  - Updated: DQ API routes require DQ session (not Capacity)
  - Updated: App shell + Settings for sign-out / user management
  - SQL: 017_dq_auth.sql, 018_ensure_dq_core_tables.sql, 001b_rebuild_dq_core_tables.sql

What you do NOT need from other WinSCP packages for this feature
------------------------------------------------------------
  - 04-winscp-update-planned-no-fallback-sunday-nesting (Capacity only)
  - public/capacity embed rebuild (not required for DQ login)
