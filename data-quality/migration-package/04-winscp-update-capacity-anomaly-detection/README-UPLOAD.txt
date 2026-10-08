WinSCP — Capacity: Anomaly Detection (forecast quality gateway)
===============================================================

CAPACITY ONLY — do not upload Data Quality (src/) files.
NO SQL / SQLyog — skip .sql scripts.

GOAL
----
After WinSCP upload + `npm run build` + pm2 restart, Capacity shows a fully
working Anomaly Detection page (nav + Staffing Plan link + templates/samples).

CRITICAL (why buttons can be missing)
-------------------------------------
The Capacity UI is served from public/capacity (embed.js + chunks), NOT from
TypeScript alone. On the server, `npm run build` often SKIPS rebuilding the
Capacity embed (Vite is a devDependency).

You MUST upload this package's public/capacity folder (step 1).
Uploading only capacity/src is NOT enough.

What this package includes
--------------------------
1) Anomaly Detection page (/anomaly) — Movate-themed
2) Upload CSV / Excel / JSON OR connect Staffing Plan Offered Volume
3) Download Template CSV / Template Excel
4) Download Sample CSV / Sample Excel (spike + dip demos)
5) "Load sample now" — instant in-app demo
6) Detection: Z-score, IQR, MAD, STL, Isolation Forest + shifts/breaks
7) Quality checks + readiness gate (blocks Apply Forecast when blocking)
8) Chart, clean actions, export cleaned data / anomaly report
9) Nav: Anomaly · Staffing Plan toolbar button · Forecasting readiness banner

=====================================================
1) WinSCP upload (Binary mode) — DO THIS FIRST
=====================================================
Upload into the APP ROOT (keep relative folders). Overwrite existing files.

A) Built embed — REQUIRED for the UI to appear
----------------------------------------------
Upload / overwrite THIS ENTIRE folder from the package:

  public/capacity/embed.js
  public/capacity/embed.css
  public/capacity/chunks/     ← upload ALL *.js files in this package folder

Tip: In WinSCP, sync or copy the whole `public/capacity` directory from this
package over the server's `public/capacity`. Do not mix old embed.js with new
chunks (or vice versa).

B) Source files — for future rebuilds / consistency
---------------------------------------------------
  capacity/src/pages/AnomalyDetectionPage.tsx
  capacity/src/planner/anomalyDetectionEngine.ts
  capacity/src/planner/anomalyDetectionEngine.test.ts   (optional)
  capacity/src/App.tsx
  capacity/src/components/shell/AppShell.tsx
  capacity/src/pages/DemoAccessPage.tsx
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/components/planner/StaffingForecastingPanel.tsx
  capacity/src/components/planner/WfmHelperPanel.tsx
  capacity/src/index.css

=====================================================
2) Build + restart (on the server, repo ROOT)
=====================================================
  npm run build
  pm2 restart data-quality-tool

Then hard-refresh the browser: Ctrl+F5

If `npm run build` prints "Capacity embed: prebuilt OK", that is expected —
it is using the public/capacity files you uploaded. That is correct.

=====================================================
3) Where to open / verify
=====================================================
  Capacity nav → Anomaly
  URL: /capacity/anomaly
  Staffing Plan toolbar → Anomaly Detection

Verify checklist:
  [ ] Anomaly nav item visible
  [ ] Template CSV / Template Excel download
  [ ] Sample CSV / Sample Excel download
  [ ] Load sample now → chart + anomalies + quality checks
  [ ] Continue to Forecasting respects readiness (blocking disables Apply)
  [ ] Forecasting panel shows anomaly gate banner

If Anomaly nav is missing after upload:
  - Confirm public/capacity/embed.js and chunks were overwritten
  - Confirm pm2 restarted
  - Hard refresh (Ctrl+F5) / try Incognito
  - Do not re-upload an older 04- package after this one (it can overwrite embed)
