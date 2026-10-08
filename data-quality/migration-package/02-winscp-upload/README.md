# Data Quality Tool

Internal web application for secure file intake, schema validation, checklist gating, and processing tracking.

## Stack

- **Next.js 15** + **TypeScript** + **Tailwind CSS**
- **Local JSON** by default; **MariaDB** for internal production
- **Papa Parse** (CSV) + **SheetJS** (Excel)

## Quick start

```bash
npm install
cp .env.example .env.local   # local dev only — JSON mode, no DB needed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## MariaDB production

1. Run in SQLyog (same database for both apps), **in this order**:
   - `database/mariadb/001_initial_schema.sql`
   - `database/mariadb/002_capacity_schema.sql`
   - `database/mariadb/004_capacity_users_active.sql` (`users.is_active`)
   - `database/mariadb/005_capacity_users_analyst.sql` (allows Analyst role)
   - `database/mariadb/006_capacity_clients.sql` (`capacity_clients`)
   - `database/mariadb/007_capacity_documents.sql` (`capacity_documents`; planning data per user)
   - `database/mariadb/008_capacity_audit_and_settings.sql` (`capacity_audit_log`, `capacity_shared_settings`)
- `database/mariadb/009_drop_ai_assistant_column.sql` (drops the unused `users.ai_assistant_approved` flag; run after the new build is live)
- `database/mariadb/010_capacity_reporting_views.sql` (read-only views for checking Capacity data in SQL)
   - `database/mariadb/003_capacity_demo_users.sql` (demo logins; runs **last**)
2. Set in `.env.local` (create it on the server from `.env.production.example`, not `.env.example`):

```
STANDALONE=false
DATA_BACKEND=mariadb
DB_HOST=...
DB_NAME=mis_ph_db
DB_USER=...
DB_PASSWORD=...
```

See `DEPLOYMENT.md` for WinSCP/PuTTY deploy steps.

## Capacity Plan module

Capacity planning is built into the main app as a **sidebar section** (not a separate app or iframe). Click **Capacity** to open `/capacity`.

The `capacity/` folder holds the React source; `npm run build` compiles it to `public/capacity/embed.js`. API routes live under `/api/capacity/*`.

See `capacity/README.md` for module details and optional standalone Vite dev.


Proprietary / internal use.
