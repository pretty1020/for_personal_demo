WinSCP — Capacity: access, WFM Helper page, forecasting charts, FTE labels
==========================================================================

CAPACITY-focused package. Paths are relative to the repo root on the server.
Do NOT mix chunks from an older package with this embed.js.

UPLOAD ORDER (avoids broken login / blank Capacity UI)
------------------------------------------------------
1) SQLyog FIRST — run this script on MariaDB (mis_ph_db):
     026_user_client_access.sql   ← also at package root for convenience
     (same file under migration-package/01-sqlyog/)
   Adds users.allowed_clients. Safe to re-run.
   Code tolerates a missing column for login, but Manager client grants
   will not save until 026 has been executed.

2) WinSCP — Binary mode — replace entire public/capacity together:
   a) Delete remote public/capacity/chunks/* (or the whole public/capacity folder)
   b) Upload this package’s public/capacity/ (embed.js, embed.css, ALL chunks, assets)
   Mixing old hashed chunks with a new embed.js causes blank pages / 404s.

3) WinSCP — overwrite listed source + API files (below).

4) PuTTY (repo root):
     npm run build
     pm2 restart data-quality-tool
   Then browser Ctrl+F5.

What this delivers
------------------
1) Labels: “Required Production FTE”; monthly Production FTE does not invent 0.
2) DBE + Leakage: Director / VP / Admin only (Managers removed).
3) Admin assigns Managers specific clients (Users). Empty grants = no clients
   (no “all clients” fallback).
4) Admin/Manager edit Staffing Plan weekly cells.
5) WFM Helper own page/nav: /wfm-helper
6) Forecasting: sample CSV download + interactive charts after generate.
7) MariaDB-only persistence (production): planning documents, DBE, overrides,
   clients, and plan UI prefs write to MariaDB. Session uses in-memory cache —
   not durable localStorage. Sign-in is cookie-backed (no local user SoT).
8) Monthly period chips: only months with imported/entered plan data (not
   2001–2027 filler). Matrix/Summary show only months the user selected.
9) documentAccess allowlist includes plan UI prefs (fixes Unknown document key).

Exceptions (not plan data):
  - wfp-act-as-v1 — tab coordination flag only (never uploaded)
  - sessionStorage auth token / anomaly readiness / error reload guard

CRITICAL — Unknown document key toasts
--------------------------------------
Uploading capacity/api/_lib/documentAccess.ts alone is NOT enough.
Next.js serves the compiled .next build. After WinSCP:
  rm -rf .next && npm run build && pm2 restart data-quality-tool
Without that rebuild, wfp-capacity-period-v2 / matrix-view-v4 still fail.

-----------------------------------------------------
1) WinSCP upload (Binary, overwrite)
-----------------------------------------------------
A) Embed (whole folder — required):
  public/capacity/embed.js
  public/capacity/embed.css
  public/capacity/chunks/   ← ALL .js from this package
  public/capacity/          ← logos/icons/avatars if present

B) Capacity UI / logic:
  capacity/src/utils/accessLevel.ts
  capacity/src/utils/clientAccess.ts
  capacity/src/context/DemoSessionContext.tsx
  capacity/src/planner/userDirectory.ts
  capacity/src/planner/clientRegistry.ts
  capacity/src/planner/ledgerPersistence.ts
  capacity/src/planner/capacityPlanOverridePersistence.ts
  capacity/src/planner/capacityMatrixDisplay.ts
  capacity/src/planner/capacityPlanDerived.ts
  capacity/src/planner/capacityFinancialCosts.ts
  capacity/src/planner/volumeForecastExport.ts
  capacity/src/planner/dbe/staffingDbeLeakage.ts
  capacity/src/planner/dbe/dbePersistence.ts
  capacity/src/data/apiClient.ts
  capacity/src/data/capacityDocuments.ts
  capacity/src/data/capacityDocumentKeys.ts
  capacity/src/data/capacityActAs.ts
  capacity/src/pages/LeakagePage.tsx
  capacity/src/pages/CapacitySummaryPage.tsx
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/pages/UserManagementPage.tsx
  capacity/src/pages/WfmHelperPage.tsx
  capacity/src/App.tsx
  capacity/src/components/shell/AppShell.tsx
  capacity/src/components/planner/CapacityPeriodFilter.tsx
  capacity/src/components/planner/StaffingForecastingPanel.tsx
  capacity/src/components/planner/WfmHelperPanel.tsx
  capacity/src/components/staffing/StaffingCapacityChartsPanel.tsx
  capacity/src/planner/capacityLookup.ts
  capacity/src/planner/capacityPeriod.ts
  capacity/src/planner/weeklyLedger.ts
  capacity/src/index.css

C) API (Capacity + Next mirrors) — required for Manager grants + login:
  capacity/api/_lib/documentAccess.ts
  capacity/api/_lib/userAdmin.ts
  capacity/api/_lib/db.ts
  capacity/api/_lib/session.ts
  capacity/api/_lib/auth.ts
  capacity/api/users/index.ts
  capacity/api/users/[id].ts
  src/lib/capacity-api/session.ts
  src/lib/capacity-api/roster-auth.ts
  src/app/api/capacity/users/route.ts
  src/app/api/capacity/users/[id]/route.ts

D) SQL (SQLyog — do not skip):
  026_user_client_access.sql
  migration-package/01-sqlyog/026_user_client_access.sql
  migration-package/01-sqlyog/README-SQLyog.txt  (optional reference)

Common WinSCP mistakes
----------------------
- Uploading only embed.js without new chunks → 404 / blank Capacity
- Leaving old chunks beside new ones → intermittent wrong bundle
- Text transfer mode → corrupted JS (use Binary)
- Skipping 026 → Manager client grants cannot be saved (login still works)
- Uploading this whole folder as a nested directory instead of merging into repo root

-----------------------------------------------------
2) Verify
-----------------------------------------------------
  [ ] Capacity sign-in works after restart
  [ ] Manager cannot open DBE or Leakage
  [ ] Admin → Users → Manager → assign clients; Manager sees only those plans
  [ ] Manager with zero clients sees no Staffing Plan clients
  [ ] WFM Helper opens from nav (/wfm-helper)
  [ ] Forecasting sample download + chart after generate
  [ ] Leakage legend: Required Production FTE
  [ ] No /capacity/chunks/*.js 404 in browser Network tab
  [ ] After edit + refresh (cleared site data optional): plan/DBE values still in MariaDB
  [ ] Application → Local Storage: no wfp-planner / wfp-dbe / wfp-ledger keys while signed in
