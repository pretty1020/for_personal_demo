# Capacity Planning Dashboard

React + Vite capacity planning app with executive financials, scenario planning, and workforce operations views.

## Prerequisites

- **Node.js** 20+
- **npm**
- **Neon** PostgreSQL database (for production)
- **Vercel** account (recommended deploy target)

## Local development (offline)

Uses browser `localStorage` — no database required.

```bash
cd excel-dashboard
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Sign in with demo credentials (shown on the login page in dev).

## Production setup (Neon + Vercel)

### 1. Create a Neon database

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string (`postgresql://...?sslmode=require`).

### 2. Initialize schema and seed users

```bash
cd excel-dashboard
npm install
DATABASE_URL="postgresql://..." npm run db:setup
```

This creates tables and seeds:

| Email | Password | Role |
|-------|----------|------|
| `admin@demo.local` | `demo` | Admin |
| `demo@demo.local` | `demo` | VP |

### 3. Deploy to Vercel

1. Import the repo and set **Root Directory** to `excel-dashboard`.
2. Add environment variables (Production + Preview):
   - `DATABASE_URL` — Neon pooled connection string
   - `OPENAI_API_KEY` — enables the AI assistant (`/api/assistant/chat`)
3. In Vercel project settings, set **Node.js Version** to **22.x** (matches `package.json` engines).
4. Deploy. Production builds automatically use `/api` for persistence.

Optional:

- `OPENAI_MODEL` — default `gpt-4o-mini`
- `ALLOWED_ORIGIN` — only if API and frontend are on different hosts

Optional client override:

- `VITE_API_BASE_URL=/api` — explicit API base (default in production)
- `VITE_API_BASE_URL=local` — force offline localStorage mode

### 4. Verify

After deploy:

| Endpoint | Expected |
|----------|----------|
| `/api/health` | `{ "ok": true, "database": "connected" }` |
| `/api/assistant/health` | `{ "ok": true, "assistant": { "openaiConfigured": true } }` |

Sign in at `/` with `admin@demo.local` / `demo`. Workspace data syncs to Neon per user. The AI assistant is available to Manager-and-above users when `OPENAI_API_KEY` is set.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (localStorage) |
| `npm run build` | Typecheck + production bundle |
| `npm run preview` | Preview production build |
| `npm run db:setup` | Apply Neon schema + seed users |

## Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, ECharts
- **API**: Vercel serverless functions in `/api`
- **Database**: Neon PostgreSQL — users, sessions, workspace JSONB blob
- **Auth**: HttpOnly session cookie + optional Bearer token; bcrypt password hashes
- **Sync**: localStorage remains the client cache; changes debounce to `PUT /api/workspace`

## Routes

- `/` — Sign in and workspace launcher
- `/capacity-plan` — Capacity matrix
- `/planning` — Planning simulator
- `/financials` — Executive financials (executive access only)
