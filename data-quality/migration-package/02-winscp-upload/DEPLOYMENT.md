# Data Quality Tool — Internal Server Deployment

## Overview

| Mode | When to use |
|------|-------------|
| **JSON (default)** | Local development, demos — `data/standalone/store.json` |
| **MariaDB** | Internal enterprise production |

Capacity planning is **embedded in the main app** (sidebar → **Capacity**). No separate server or port is required.

## Environment variables

**Production (MariaDB):** copy `.env.production.example` → `.env.local` **on the server**. The template ships inside the upload as `migration-package/02-winscp-upload/.env.production.example`; its source is `migration-package/03-putty/env.production.example`. There is no `.env.production.example` at the repo root.  
**Local JSON demos only:** copy `.env.example` → `.env.local` (defaults `STANDALONE=true`). This file is deliberately **not** shipped in the upload.  
**Never commit credentials.**

### Local / JSON mode (default)
```
STANDALONE=true
```

### MariaDB production mode
```
STANDALONE=false
DATA_BACKEND=mariadb
DB_HOST=your-mariadb-host
DB_PORT=3306
DB_NAME=mis_ph_db
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_POOL_SIZE=10
COOKIE_SECURE=false
```

`COOKIE_SECURE=false` for `http://` internal servers; set `true` only behind HTTPS.
## Database setup (MariaDB + SQLyog)

**Requirements:** MariaDB **10.2.7+** (JSON type). Prefer **10.4+**.

1. Connect SQLyog to your MariaDB server.
2. **Tools → Execute SQL Script…** → `database/mariadb/001_initial_schema.sql` → Execute.
3. **Tools → Execute SQL Script…** → `database/mariadb/002_capacity_schema.sql` → Execute.
4. **Tools → Execute SQL Script…** → `database/mariadb/004_capacity_users_active.sql` → Execute (`users.is_active`; required before demo seed on upgraded DBs).
5. **Tools → Execute SQL Script…** → `database/mariadb/005_capacity_users_analyst.sql` → Execute (allows Analyst role).
6. **Tools → Execute SQL Script…** → `database/mariadb/006_capacity_clients.sql` → Execute (creates `capacity_clients`).
7. **Tools → Execute SQL Script…** → `database/mariadb/007_capacity_documents.sql` → Execute (creates `capacity_documents`).
8. **Tools → Execute SQL Script…** → `database/mariadb/008_capacity_audit_and_settings.sql` → Execute (creates `capacity_audit_log`, `capacity_shared_settings`).
9. **Tools → Execute SQL Script…** → `database/mariadb/009_drop_ai_assistant_column.sql` → Execute (drops the unused `users.ai_assistant_approved` flag). Run this **after** the new build is live — the previous build still names that column when creating a user.
10. **Tools → Execute SQL Script…** → `database/mariadb/010_capacity_reporting_views.sql` → Execute (read-only views for checking Capacity data in SQL).
11. **Tools → Execute SQL Script…** → `database/mariadb/003_capacity_demo_users.sql` → Execute (demo Capacity logins).
12. Confirm database `mis_ph_db` with main app tables plus Capacity tables (`users`, `sessions`, `workspace_state`, `capacity_clients`, `capacity_documents`, `capacity_audit_log`, `capacity_shared_settings`).

Optional — seed Capacity demo users from the server:

```bash
cd capacity
DB_HOST=... DB_NAME=mis_ph_db DB_USER=... DB_PASSWORD=... npm run db:setup
```

The script applies `002_capacity_schema.sql`, `004_capacity_users_active.sql`, `005_capacity_users_analyst.sql`, `006_capacity_clients.sql`, `007_capacity_documents.sql`, `008_capacity_audit_and_settings.sql`, `009_drop_ai_assistant_column.sql`, and `010_capacity_reporting_views.sql` (all safe to re-run), then seeds demo logins. It does **not** create the database, so `001_initial_schema.sql` must already have run.

The script runs against `mis_ph_db` (via `DB_NAME`). Re-running is safe (`IF NOT EXISTS`).

**Important:** SQLyog over SSH tunnel (`localhost`) is not the same host the app server must use. Set `DB_HOST` to what the **application server** can reach.

## File storage (internal server)

- `data/uploads/` — incoming files
- `data/processed/` — processed copies
- `data/standalone/store.json` — only when `STANDALONE=true`
- `public/capacity/` — generated at build time (`npm run build:capacity-embed` runs automatically via `prebuild`)

Ensure read/write permissions on `data/`.

## Ready-to-migrate folder

A prebuilt package lives in **`migration-package/`** — use **only** that folder for SQLyog / WinSCP / PuTTY:

| Folder | Tool |
|--------|------|
| `01-sqlyog/` | SQL scripts for SQLyog |
| `02-winscp-upload/` | Clean app tree for WinSCP (no `node_modules`, no secrets) |
| `03-putty/` | Server env template + PuTTY commands |

Start here: `migration-package/START-HERE.txt`

Refresh after code changes:

```powershell
npm run build:capacity-embed
powershell -File .\scripts\prepare-migration-package.ps1
```

See `migration-package/README.md`.

## Deploy via WinSCP + PuTTY + SQLyog

### A. SQLyog (database) — do this once per environment

1. Connect to MariaDB.
2. Run `database/mariadb/001_initial_schema.sql` (creates `mis_ph_db` + main app tables).
3. Run `database/mariadb/002_capacity_schema.sql` (Capacity `users` / `sessions` / `workspace_state`).
4. Run `database/mariadb/004_capacity_users_active.sql` (`users.is_active`; required for login + User management on upgraded DBs).
5. Run `database/mariadb/005_capacity_users_analyst.sql` (allows Analyst access_level).
6. Run `database/mariadb/006_capacity_clients.sql` (`capacity_clients`; clients persist in MariaDB, not browser storage).
7. Run `database/mariadb/007_capacity_documents.sql` (`capacity_documents`; staffing plans, overrides and DBE lines persist in MariaDB).
8. Run `database/mariadb/008_capacity_audit_and_settings.sql` (`capacity_audit_log` for the admin activity trail; `capacity_shared_settings` for admin-managed formulas).
9. Run `database/mariadb/003_capacity_demo_users.sql` (demo Capacity logins; password `movate`).
10. After the new build is serving traffic (section C), run `database/mariadb/009_drop_ai_assistant_column.sql` (drops the unused `users.ai_assistant_approved` flag).
11. Confirm DB name is **`mis_ph_db`**.

### B. WinSCP — upload these

| Upload | Notes |
|--------|--------|
| `src/` | Main Next.js app |
| `capacity/` | Capacity source (needed for embed build on server) |
| `database/` | SQL scripts (reference; already applied via SQLyog) |
| `public/` | Includes `public/capacity/` embed assets (or rebuild on server) |
| `data/` | Keep `.gitkeep` folders; ensure writable on server |
| Root configs | `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `next-env.d.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `eslint.config.mjs`, `vercel.json` (optional), `.env.production.example`, `SERVER-SETUP.txt`, `server-commands.sh`, `DEPLOYMENT.md`, `README.md`, `MIGRATION-README.md` |

Create **`.env.local` on the server only** (copy from **`.env.production.example`**, not `.env.example`). Do **not** upload your PC’s `.env` / `.env.local` / `capacity/.env`.

### C. WinSCP — do **not** upload

- `node_modules/`, `capacity/node_modules/`
- `.next/`, `capacity/dist/`
- `.git/` (optional; not required to run)
- `.env`, `.env.local`, `capacity/.env`, `capacity/.env.local`
- `*.zip`, `* - Copy*`, `.tmp-*`, IDE junk

### D. PuTTY (SSH) — build & run

```bash
cd /path/to/Data_Quality_Tool   # your upload path

# Create server env (edit with real MariaDB credentials)
cp .env.production.example .env.local
# nano .env.local  → STANDALONE=false, DATA_BACKEND=mariadb, DB_*=mis_ph_db, COOKIE_SECURE=false for HTTP
# Do NOT use .env.example here — it defaults STANDALONE=true.
npm install
cd capacity && npm install && cd ..

npm run build    # prebuild → Capacity embed, then Next.js
npm run start    # binds 0.0.0.0:3000 so other PCs can reach the server
```

`npm run start` runs in the foreground and stops when the SSH session closes. For anything other than a quick test, run it under PM2:

```bash
sudo npm install -g pm2
pm2 start npm --name data-quality-tool -- start
pm2 save
pm2 startup      # run the command it prints, to start on boot
```

**Redeploying later:** upload the changed files, then `rm -rf .next && npm run build && pm2 restart data-quality-tool`, and hard-refresh the browser once (Ctrl+Shift+R). Every build regenerates `public/capacity/` with new chunk filenames, so a stale cached page would otherwise request chunks that no longer exist.

**Node.js:** use **22.x** on the server (`node -v`).

Ensure `data/` is writable (`chmod -R u+rwX data`). Open firewall TCP **3000** if clients are remote.

No separate Capacity port. No `NEXT_PUBLIC_CAPACITY_APP_ORIGIN`.

## Post-deploy checklist

- [ ] `/api/config` returns `dataBackend: "mariadb"` and `dbConnected: true`
- [ ] Dashboard loads
- [ ] Upload + validation works
- [ ] Workflow create/edit saves to database
- [ ] Checklist acknowledgment works
- [ ] **Capacity** nav opens staffing plan at `/capacity`
- [ ] `/api/capacity/health` returns `database: "connected"` when MariaDB is configured

## Troubleshooting

| Issue | Action |
|-------|--------|
| `503` on API routes | Check env vars; verify MariaDB reachable from app server |
| Upload fails | Check `data/uploads/` permissions |
| Connection timeout | Firewall: app server → MariaDB port 3306 |
| SQLyog script error | Upgrade MariaDB to 10.2.7+ |
| Times look offset | App stores UTC; SQLyog may show local time |
| Capacity section blank | Run `npm run build:capacity-embed`; check browser console for `/capacity/embed.js` |
| Capacity API errors | Set same `DB_*` vars; verify `/api/capacity/health` |
| Capacity login fails on `http://` | Set `COOKIE_SECURE=false` (default for HTTP). Use `COOKIE_SECURE=true` only behind HTTPS |
| Capacity login / workspace 503 | Run SQLyog `004` → `005` → `003`, or `cd capacity && npm run db:setup`; check `/api/capacity/health` |
| Analyst role rejected by DB | Run `005_capacity_users_analyst.sql` (CHECK must include `analyst`) |
| `001` fails with `errno: 150 "Foreign key constraint is incorrectly formed"` on `workflow_rules` / `required_columns` / `files` | A `workflows` table from an older schema is still in the database, and `CREATE TABLE IF NOT EXISTS` keeps it. Re-run the current `001_initial_schema.sql`: it converts `workflows` to InnoDB and `id` to `CHAR(36) utf8mb4_unicode_ci` before the dependent tables are created |
| Clients not saving / `capacity_clients` missing | Run `006_capacity_clients.sql`, then sign out and back in to re-sync |
| Plans/DBE not saving, or "could not be saved" badge | Run `007_capacity_documents.sql`, then sign out and back in; check `/api/capacity/health` |
| Admin audit page empty / `capacity_audit_log` missing | Run `008_capacity_audit_and_settings.sql`, then restart the app |
| Formula edits not saving / `capacity_shared_settings` missing | Run `008_capacity_audit_and_settings.sql`; only an admin account may save formulas |
| Capacity Users page errors / unknown column `is_active` | Run `004_capacity_users_active.sql` then restart the app |
| Capacity blank / `/chunks/*.js` 404 | Rebuild embed (`npm run build:capacity-embed`); Next rewrites `/chunks/*` → `/capacity/chunks/*` |
| `500` / `Cannot find module './####.js'` | Corrupted `.next` cache — delete `.next` then `npm run build` (or `npm run start:clean` / `npm run dev:clean`) |
| App only works on the server itself | `npm run start` binds `0.0.0.0:3000`; open firewall TCP 3000; use `http://<server-ip>:3000` |
| `npm` / engine errors in capacity | Install **Node.js 22.x** on the server (`node -v`) |
| Upload / file save fails | `chmod -R u+rwX data` (or chown to the Node process user) |
| `STANDALONE=true` after deploy | Recreate `.env.local` from `.env.production.example`, not blank `.env.example` |

## Multi-user (Capacity)

Capacity is safe for **simultaneous users** when MariaDB is configured:

- Each login creates its own row in `sessions` (multiple browsers / users at once).
- Planner/DBE/settings state is stored per user in `workspace_state` (`user_id` PK).
- Login/logout clears browser workspace keys, then loads that user's remote snapshot (avoids User A data leaking to User B on a shared PC).
- Roster APIs require a real session cookie/token — client-claimed role flags are ignored when the DB is up.
- Admins manage accounts under Capacity → **Users** (MariaDB `users` table).

**Note:** The main Data Quality Tool (non-Capacity) remains a shared team workspace, not per-user auth.

**Same user, two tabs:** last workspace save wins (expected). Use separate Capacity accounts for true isolation.
