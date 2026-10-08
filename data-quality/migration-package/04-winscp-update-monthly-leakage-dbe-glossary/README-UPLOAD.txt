WinSCP — Monthly metrics, Leakage FTE, DBE HC match, attrition, glossary
=======================================================================

CAPACITY-only package. Paths are relative to the repo root on the server.
Do NOT mix old hashed chunks with this embed.js.
Do NOT run or change Data Quality SQLyog migrations for this package.

What this delivers
------------------
1) Monthly view: Offered to Forecast %, Handled volume variance, AHT variance,
   Occupancy variance populate on Actual months (were blank).
2) DBE upload: upsert by Client+LOB+Location+Project Code (unchanged merge);
   FTE billing copies Capacity → FTE when FTE cell blank.
   Financial Summary Staffing match prefers Client + Project Code.
3) Leakage: Variance = Production FTE − Required Production FTE (from Staffing
   monthly metrics). Negative = Understaffing; positive = Overstaffing.
   LOB filter + searchable client multi-select.
4) Staffing Plan: Admin/Manager cell edits (weekly) persist to MariaDB;
   foreign plans stay read-only.
5) Actual Attrition % =
   Actual Production HC Attrition / (Planned Production HC − Attrition HC).
6) WFM Helper glossary: Production FTE and related WFM terms.

UPLOAD ORDER
------------
1) WinSCP Binary — replace entire public/capacity together:
   a) Delete remote public/capacity/chunks/* (or whole public/capacity)
   b) Upload this package’s public/capacity/

2) WinSCP — overwrite source files listed below into the app root.

3) PuTTY (repo root):
     rm -rf .next && npm run build && pm2 restart data-quality-tool
   Then browser Ctrl+F5.

Files to overwrite
------------------
A) Embed (whole folder):
  public/capacity/

B) Capacity sources:
  capacity/src/planner/capacityMatrixDisplay.ts
  capacity/src/planner/capacityPlanDerived.ts
  capacity/src/planner/dbe/staffingDbeLeakage.ts
  capacity/src/planner/dbe/staffingMonthDrivers.ts
  capacity/src/planner/dbe/dbeClientTemplate.ts
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/pages/LeakagePage.tsx
  capacity/src/components/planner/WfmHelperPanel.tsx
  capacity/src/index.css

C) Optional (if Unknown document key still appears):
  capacity/api/_lib/documentAccess.ts
  then rebuild (step 3) — upload alone is not enough.

Verify
------
  [ ] Monthly Actual columns show Offered to Forecast % and variances
  [ ] Leakage Sep Production FTE matches Staffing Plan Production FTE
  [ ] Negative Production−Required shows as Understaff $
  [ ] Leakage LOB filter works; client search filters chips
  [ ] DBE Financial Summary shows Planned Production HC when Client+Project match
  [ ] Actual Attrition % no longer >100% with normal HC
  [ ] WFM Helper glossary includes Production FTE
  [ ] Admin/Manager can edit weekly Staffing cells; values survive refresh
