# Smart AI Auditor for Cafes & Restaurants

Next.js + TypeScript web app for cafe and restaurant owners: upload sales, inventory, expense, and staff files to Supabase Storage, normalize rows into Postgres, then review KPIs, Recharts dashboards, a rule-based profit-leak scanner, and OpenAI-generated findings plus a 7-day action plan. Currency is **Philippine Peso (₱)** throughout.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | Supabase anon key (RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Storage download + bulk ingest + demo/reset + persisting audits (never expose to the browser) |
| `OPENAI_API_KEY` | **Server only** | Optional; without it, rule-based findings still run and the UI explains that AI narrative is disabled |
| `NEXT_PUBLIC_DEMO_LOGIN_ENABLED` | Client | Set to `true` to show **Sign in as demo** on `/auth` |
| `NEXT_PUBLIC_DEMO_EMAIL` | Client | Optional hint text (should match the demo user email) |
| `DEMO_USER_EMAIL` | **Server only** | Email for one-click demo login |
| `DEMO_USER_PASSWORD` | **Server only** | Password for that user (never `NEXT_PUBLIC_*`) |

Copy `.env.example` to `.env.local` for local development.

### Demo credentials (assigned defaults)

Use these **only for local or staging**; change them in production.

1. In Supabase **Authentication → Users → Add user**, create:
   - **Email:** `demo@smart-auditor.local`
   - **Password:** `SmartDemo2026!`  
   Enable “Auto Confirm User” for dev if email confirmation is on.

2. In `.env.local`, set (see `.env.example`):
   - `NEXT_PUBLIC_DEMO_LOGIN_ENABLED=true`
   - `NEXT_PUBLIC_DEMO_EMAIL=demo@smart-auditor.local`
   - `DEMO_USER_EMAIL=demo@smart-auditor.local`
   - `DEMO_USER_PASSWORD=SmartDemo2026!`

3. Restart `npm run dev`. On `/auth`, use **Sign in as demo** or sign in manually with the same email and password.

## Supabase setup

1. Create a project at [https://supabase.com](https://supabase.com).
2. **Authentication → Providers**: enable Email (password). Adjust “Confirm email” for development if you prefer faster sign-up.
3. Open the SQL editor and run `supabase/schema.sql` from this repo. It creates:
   - `users`, `businesses`, `uploads`, `sales_data`, `inventory_data`, `expense_data`, `staff_data`, `audit_findings`, `audit_reports`
   - Row Level Security policies scoped to the signed-in owner
   - A private Storage bucket `reports` with policies so each user can only read/write objects under their `auth.uid()` folder prefix
4. If Storage bucket creation fails in SQL, create bucket `reports` manually (private), then re-run only the Storage policy section from the schema file.

### Trigger compatibility

If Postgres rejects `EXECUTE FUNCTION` in triggers, replace with `EXECUTE PROCEDURE` for your database version, or run the trigger block from the Supabase SQL template for your project version.

## Local development

```bash
cd smart-ai-auditor
npm install
npm run dev
```

Open `http://localhost:3000`. Sign up, create a business, upload CSV/XLSX files (or use **Load demo data** on the Upload page), then open the dashboard and click **Refresh AI audit**.

## Render deployment

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start`
- **Root directory:** if this app lives in a monorepo subfolder, set Render’s root directory to `smart-ai-auditor`.

See `render.yaml` for a starter service definition. Add the same environment variables in the Render dashboard. Use Node 20+.

## Sample templates

CSV layouts are under `public/samples/` (`sales_template.csv`, `inventory_template.csv`, `expense_template.csv`, `staff_template.csv`). The uploader accepts **CSV or XLSX**; column names do not need to match exactly because the app scores common synonyms.

## AI behavior

- Server prompts require **no invented numbers**; the model only interprets KPIs and aggregates you already uploaded.
- Rule-based findings always run first; OpenAI extends with narrative and a structured action plan when `OPENAI_API_KEY` is set.

## Security notes

- Never commit `.env.local` or the service role key.
- Demo data and reset endpoints use the service role after verifying the authenticated user owns the business.

## Next.js advisory

This scaffold was generated with Next 15.1.x; check [Next.js security advisories](https://nextjs.org/blog) and upgrade to a patched release when you deploy to production.
