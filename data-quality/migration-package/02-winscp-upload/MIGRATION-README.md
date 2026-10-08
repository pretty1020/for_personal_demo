# Migration package — WinSCP + SQLyog + PuTTY

**You are reading this on the server.** This folder is the uploaded app; the
SQLyog scripts also ship here under `database/mariadb/`.

Server steps: **`SERVER-SETUP.txt`** in this folder.

---

## 1. SQLyog (database)

1. Open SQLyog → connect to MariaDB.
2. Run in order (from `database/mariadb/` in this folder):
   - `001_initial_schema.sql`
   - `002_capacity_schema.sql`
   - `004_capacity_users_active.sql` (required for login + User management on upgraded DBs; safe if already applied)
   - `005_capacity_users_analyst.sql` (allows Analyst role; safe if already applied)
   - `006_capacity_clients.sql` (creates `capacity_clients`; clients persist in MariaDB, not browser storage)
   - `007_capacity_documents.sql` (creates `capacity_documents`; scenarios, overrides and DBE lines persist in MariaDB)
   - `008_capacity_audit_and_settings.sql` (creates `capacity_audit_log` for the admin activity trail, and `capacity_shared_settings` for admin-managed formulas)
   - `009_drop_ai_assistant_column.sql` (drops the unused `users.ai_assistant_approved` flag; run it **after** the new build is live in PuTTY, since the previous build still names that column when creating a user)
   - `010_capacity_reporting_views.sql` (read-only views for checking Capacity data in SQL: `v_capacity_clients`, `v_capacity_storage`, plus `v_capacity_plans` / `v_capacity_teams` / `v_capacity_dbe` on MariaDB 10.6+)
   - `003_capacity_demo_users.sql` (demo logins; password **movate**)
3. Confirm database **`mis_ph_db`**.

Details: `README-WinSCP.txt` and `SERVER-SETUP.txt`

---

## 2. WinSCP (upload app)

1. Open the `02-winscp-upload/` folder on your PC
2. In WinSCP, upload **everything inside** that folder to your app path  
   (example: `/var/www/Data_Quality_Tool`).
3. Do **not** upload secrets from your PC. This folder has no `.env.local`.
4. On the server, create env from **`.env.production.example`** only (not any local demo env).

Included server helpers (after upload):
- `.env.production.example` → copy to `.env.local` on the server
- `SERVER-SETUP.txt` → PuTTY steps
- `server-commands.sh` → optional install/build script

Running behind Nginx? Use `nginx-data-quality-tool.conf` rather than writing
one by hand — it carries the upload limit, timeouts, forwarded headers and buffer sizes
this app needs. `PORT` in `.env.local` and `proxy_pass` in that file must name the same
port; a mismatch is the usual cause of **502 Bad Gateway**. Section 10 of `SERVER-SETUP.txt` walks through diagnosing a 502.

Details: `README-WinSCP.txt`

---

## 3. PuTTY (install, build, start)

1. SSH into the same server (**Node.js 22.x** required).
2. Follow `SERVER-SETUP.txt` in this folder.
3. Create `.env.local` from `.env.production.example` (`COOKIE_SECURE=false` for HTTP).
4. `chmod -R u+rwX data`
5. `npm install` → `cd capacity && npm install` → `cd ..` → `npm run build` → `npm run start`
6. Open `http://<server-ip>:3000` (start binds `0.0.0.0:3000`).

`npm run start` stops when the SSH session closes. To keep it running:

```bash
sudo npm install -g pm2
pm2 start npm --name data-quality-tool -- start
pm2 save
pm2 startup      # run the command it prints
```

**Redeploy later:** upload changed files, then `rm -rf .next && npm run build && pm2 restart data-quality-tool`, and hard-refresh the browser once (Ctrl+Shift+R) — each build renames the Capacity chunk files.

Or run:

```bash
bash server-commands.sh /path/to/Data_Quality_Tool
```

---

## After deploy

- `/api/config` → `dataBackend: "mariadb"`, `dbConnected: true`
- `/capacity` opens Capacity
- `/api/capacity/health` → `database: "connected"`
- Sign in with `test@movate.com` / `movate` (after script 003)
- Multi-user: two browsers can sign in as different users at once; each keeps their own workspace in `workspace_state`

### If Capacity login fails after migrate

1. Re-run **`database/mariadb/003_capacity_demo_users.sql`** in SQLyog (updates password hashes to `movate`).
2. Confirm `.env.local` has `STANDALONE=false`, `DATA_BACKEND=mariadb`, correct `DB_*`, and `COOKIE_SECURE=false` for HTTP.
3. Confirm Node is **22.x** (`node -v`) then restart: `npm run start`.
4. Optional alternate seed from PuTTY (after `npm install` in `capacity/`):

```bash
cd capacity
DB_HOST=... DB_NAME=mis_ph_db DB_USER=... DB_PASSWORD=... npm run db:setup
```

