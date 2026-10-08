# Capacity Plan (Movate)

Workforce capacity planning module embedded in the **Data Quality Tool** main app. Uses the shared MariaDB database **`mis_ph_db`**.

## Features

- Staffing capacity matrix (`/capacity/capacity-plan`)
- Summary, DBE revenue modeling, leakage analysis
- Plan settings, setup wizard, user management
- Excel import/export, MariaDB workspace sync (scenarios, DBE, planner data)
- Roster sync (when configured)

## Running in the main app (recommended)

Capacity is a single nav section in the main app — no separate port or iframe.

```bash
# From repo root
npm install
cd capacity && npm install && cd ..
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Capacity** in the sidebar.

The embed bundle (`public/capacity/embed.js`) is rebuilt automatically before `npm run dev` and `npm run build`.

### Environment (root `.env.local`)

```env
STANDALONE=false
DATA_BACKEND=mariadb
DB_HOST=localhost
DB_NAME=mis_ph_db
DB_USER=...
DB_PASSWORD=...
```

API routes: `/api/capacity/*` (auth, workspace, roster).

### Demo login

| Email | Password | Role |
|-------|----------|------|
| `test@movate.com` | `movate` | Admin |
| `ben@movate.com` | `movate` | Director |
| `marian@movate.com` | `movate` | Capacity planner |

With MariaDB configured, seed accounts via:

```bash
cd capacity
DB_HOST=... DB_NAME=mis_ph_db DB_USER=... DB_PASSWORD=... npm run db:setup
```

Without MariaDB, the embed falls back to localStorage demo mode.

## MariaDB setup (SQLyog)

Run on database **`mis_ph_db`**:

1. `database/mariadb/001_initial_schema.sql` — main app tables
2. `database/mariadb/002_capacity_schema.sql` — Capacity (`users`, `sessions`, `workspace_state`)

Then optionally: `npm run db:setup` (from `capacity/`).

## Standalone Vite dev (optional)

For isolated UI work without the main Next.js shell:

```bash
cd capacity
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Configure `capacity/.env.local` with `VITE_API_BASE_URL=/api` and run the main app's API separately, or use localStorage demo mode.

## WinSCP / company server deploy

Upload the **full repo** (main app + `capacity/` source). On the server:

```bash
npm install
cd capacity && npm install && cd ..
npm run build
npm run start
```

No separate Capacity server. No `NEXT_PUBLIC_CAPACITY_APP_ORIGIN`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build:embed` | Build embed bundle → `public/capacity/` |
| `npm run dev` | Standalone Vite dev (optional) |
| `npm run db:setup` | Apply Capacity schema + seed demo users |
| `npm test` | Vitest unit tests |
