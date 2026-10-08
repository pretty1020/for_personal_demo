WinSCP — Capacity Staffing Plan: Forecasting + WFM Helper + Forecast Download
=============================================================================

CAPACITY ONLY — do not upload Data Quality (src/) files.

SQL / SQLyog
------------
No database schema change for this update. Skip SQLYog / .sql scripts.

IMPORTANT — why buttons were missing after npm run build
--------------------------------------------------------
The Staffing Plan UI is served from public/capacity (embed.js + chunks), NOT from
capacity/src TypeScript alone.

On the server, npm run build often SKIPS rebuilding the Capacity embed (vite is a
devDependency and is not installed in production). Uploading only capacity/src and
running npm run build leaves the OLD embed — so Forecasting / WFM Helper never appear.

You MUST upload the rebuilt public/capacity assets from this package (step 1b).

What this adds
--------------
1) Forecasting button (highlighted; panel hidden by default)
   - Input: Offered Volume (Actuals or CSV upload)
   - Models: Moving Average, Trend, SES, Seasonal naïve, Holt-Winters,
     ARIMA-like, Prophet-like — with MAPE / RMSE / MAE and Best-fit highlight
2) Apply to Staffing Plan → writes Forecast Volume into future weeks (callVolume)
3) Historical upload: Daily / Weekly / Monthly CSV → weekly Offered Volume
4) Day-of-week trend bars from daily uploads (Sat/Sun lows, etc.)
5) Download Forecast Volume from the selected / best-fit model run:
   - Daily CSV / Weekly CSV / Monthly CSV / All (Excel)
6) WFM Helper: glossary, Erlang/FTE calculator, quick reference

-----------------------------------------------------
1a) WinSCP upload — source (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload into the app root (keep relative folders):

  capacity/src/planner/volumeForecastModels.ts                 ← NEW
  capacity/src/planner/volumeForecastEngine.ts                 ← NEW
  capacity/src/planner/volumeForecastExport.ts                 ← NEW
  capacity/src/components/planner/StaffingForecastingPanel.tsx ← NEW
  capacity/src/components/planner/WfmHelperPanel.tsx           ← NEW
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/index.css

Optional (tests only — not required on server):
  capacity/src/planner/volumeForecastEngine.test.ts
  capacity/src/planner/volumeForecastExport.test.ts

-----------------------------------------------------
1b) WinSCP upload — built embed (REQUIRED for UI)
-----------------------------------------------------
Upload / overwrite the FULL folder (do not mix with older chunks):

  public/capacity/embed.js
  public/capacity/embed.css
  public/capacity/chunks/     ← upload ALL files in this folder from this package

If you leave old chunk files that are no longer referenced, that is OK.
If you keep an OLD embed.js with NEW chunks (or vice versa), the UI will break —
always take embed.js + embed.css + chunks together from this same package.

-----------------------------------------------------
2) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

Then hard-refresh the browser (Ctrl+F5) on Capacity → Staffing Plan.

-----------------------------------------------------
3) Where to see the buttons
-----------------------------------------------------
  Capacity → Staffing Plan → toolbar above the matrix
  Next to Charts / Summary:  Forecasting  |  WFM Helper

  Requires a single scenario (not Combined All / Client / Project view).

-----------------------------------------------------
4) Verify
-----------------------------------------------------
  - Forecasting (highlighted) opens the panel
  - Models table shows MAPE/RMSE/MAE; Best fit badge appears
  - Upload a daily CSV → DOW bars + weekly aggregate
  - Apply → future weeks Forecast Volume update on the matrix
  - Download Daily / Weekly / Monthly CSV or All (Excel)
  - WFM Helper → glossary search + calculator results
