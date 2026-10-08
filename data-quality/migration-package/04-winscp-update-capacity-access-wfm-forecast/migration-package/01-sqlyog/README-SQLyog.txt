SQLyog — run these scripts IN ORDER on MariaDB

This is step 1 of migration-package (see ../START-HERE.txt).
Requirements: MariaDB 10.2.7+ (prefer 10.4+)

1. Connect SQLyog to your MariaDB server.
2. Tools → Execute SQL Script… → 001_initial_schema.sql → Execute
   (Creates database mis_ph_db + main Data Quality tables)
   If 001 fails with errno 150 or Error 1833:
     BACKUP first, then run 001b_rebuild_dq_core_tables.sql (drops/recreates DQ core tables).
     Do not use 001a for broken FK installs — prefer 001b.
2b. Tools → Execute SQL Script… → 017_dq_auth.sql → Execute
   (Creates dq_users + dq_sessions for Data Quality login — separate from Capacity.
    Seed admin: dq.admin@movate.com / DqAdmin!2026 — change after first login.)
2c. If Dashboard says workflows doesn't exist:
    Tools → Execute SQL Script… → 018_ensure_dq_core_tables.sql → Execute
    (If that fails with errno 150, run 001b_rebuild_dq_core_tables.sql instead.)
2d. Tools → Execute SQL Script… → 021_workflow_client_name.sql → Execute
   (Adds workflows.client_name for Client Name on create + Dashboard. Safe to re-run.)
2e. Tools → Execute SQL Script… → 022_workflow_schedule_meta.sql → Execute
   (Optional columns: upload_frequency, allow_duplicates, data_owners. App also stores these in pass_rules.)
3. Tools → Execute SQL Script… → 002_capacity_schema.sql → Execute
   (Creates Capacity tables: users, sessions, workspace_state)
4. Tools → Execute SQL Script… → 004_capacity_users_active.sql → Execute
   (Adds users.is_active for login + User management; safe if column already exists)
5. Tools → Execute SQL Script… → 005_capacity_users_analyst.sql → Execute
   (Allows Analyst access_level; safe to re-run)
5b. Tools → Execute SQL Script… → 026_user_client_access.sql → Execute
   (Adds users.allowed_clients JSON — Admin assigns which clients a Manager
    may view/edit on Staffing Plan. Empty = no clients; no fallback to all.
    Required before deploying Manager client grants. Safe to re-run)
6. Tools → Execute SQL Script… → 006_capacity_clients.sql → Execute
   (Creates capacity_clients — clients are stored in MariaDB, not browser storage)
7. Tools → Execute SQL Script… → 007_capacity_documents.sql → Execute
   (Creates capacity_documents — staffing plans, overrides and DBE lines
    are saved per user in MariaDB and survive clearing the browser)
8. Tools → Execute SQL Script… → 008_capacity_audit_and_settings.sql → Execute
   (Creates capacity_audit_log — the admin activity trail recording who changed
    what and whose data they changed; and capacity_shared_settings, which holds
    the formulas an admin edits once for everyone)
9. Tools → Execute SQL Script… → 009_drop_ai_assistant_column.sql → Execute
   (Drops users.ai_assistant_approved, a leftover flag for a feature the app does
    not have. Run this AFTER the new code is uploaded and built in PuTTY — the
    previous build still names the column when creating a user. Safe to re-run)
10. Tools → Execute SQL Script… → 010_capacity_reporting_views.sql → Execute
   (Creates read-only views so you can check Capacity data in SQL:
    v_capacity_clients, v_capacity_storage, and — on MariaDB 10.6+ —
    v_capacity_plans, v_capacity_teams, v_capacity_dbe. Views read the live
    tables, so they never hold a stale second copy. Safe to re-run)
11. Tools → Execute SQL Script… → 011_staffing_plan.sql → Execute
   (Creates staffing_plan — Required Production FTE in required_production_fte
    and Production FTE in production_fte per scenario week. Safe to re-run)
11b. Tools → Execute SQL Script… → 012_staffing_plan_normalized.sql → Execute
   (Renames legacy required_hc → required_production_fte / production_hc →
    production_fte if present, and creates staffing_plan_shrinkage for the
    Shrinkage Breakdown. Required after any earlier 011 that used required_hc.
    Safe to re-run)
12. Tools → Execute SQL Script… → 003_capacity_demo_users.sql → Execute
   (Seeds demo logins — recommended for first Capacity sign-in)
13. Refresh object browser and confirm database name: mis_ph_db

To confirm Capacity data is really in MariaDB:
  SELECT required_production_fte, production_fte FROM staffing_plan LIMIT 20;
  SELECT * FROM staffing_plan_shrinkage LIMIT 20;
    SELECT * FROM v_capacity_clients;      -- every client, newest last
    SELECT * FROM v_capacity_storage;      -- what each planner has saved
    SELECT * FROM v_capacity_plans;        -- one row per client/LOB plan (10.6+)
    SELECT * FROM v_capacity_dbe;          -- one row per DBE line (10.6+)
    SELECT scenario_id, week_start, required_hc, production_hc
      FROM staffing_plan ORDER BY updated_at DESC LIMIT 50;
  Capacity tables are named capacity_clients, capacity_documents, and staffing_plan.
  Required Production FTE is staffing_plan.required_hc. There is no table called
  clients or capacity_plans; a SELECT against those returns nothing because they
  belong to a different schema, not this one.

Demo logins (password for all: movate)
  - test@movate.com   (admin)
  - ben@movate.com    (director)
  - marian@movate.com (cap_planner)

If 001 fails with errno 150 "Foreign key constraint is incorrectly formed"
(on workflow_rules, required_columns or files):
  The database already holds a workflows table from an older schema, and
  CREATE TABLE IF NOT EXISTS keeps it as-is, so repeat runs never fix it.
  The child tables declare workflow_id as CHAR(36) utf8mb4_unicode_ci and
  InnoDB refuses a foreign key unless the parent column matches exactly.
  Just run this 001_initial_schema.sql again — it now converts workflows to
  InnoDB and its id column to CHAR(36) utf8mb4_unicode_ci before creating the
  dependent tables. To see the current definition first:

    USE mis_ph_db;
    SELECT ENGINE, TABLE_COLLATION FROM information_schema.TABLES
     WHERE TABLE_SCHEMA='mis_ph_db' AND TABLE_NAME='workflows';
    SELECT COLUMN_NAME, COLUMN_TYPE, COLLATION_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA='mis_ph_db' AND TABLE_NAME='workflows' AND COLUMN_NAME='id';

Notes:
- Re-running is safe (IF NOT EXISTS / ON DUPLICATE KEY UPDATE / conditional ALTER).
- Order matters on upgraded databases: run 004, 005, then 006 before 003.
- Tables created: users, sessions, workspace_state, capacity_clients.
- Access: Manager+ (manager, director, vp, admin) see all pages including DBE and Leakage.
  Analyst and Capacity planner / Scheduler do not get DBE or Leakage.
- If SQLyog uses an SSH tunnel to "localhost", that is only for SQLyog.
  On the app server, set DB_HOST to the host the Node/Next process can reach.
- Alternate seed from PuTTY after npm install in capacity/:
    cd capacity
    DB_HOST=... DB_NAME=mis_ph_db DB_USER=... DB_PASSWORD=... npm run db:setup
- Admin users can manage accounts in Capacity → Users (MariaDB-backed when the API is connected).
