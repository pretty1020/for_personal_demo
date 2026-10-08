WinSCP — Capacity: manual input → MariaDB + period/Leakage/DBE fixes
====================================================================

CAPACITY ONLY — do not upload Data Quality (src/) files.
NO SQL / SQLyog for this package.

SUPERSEDES
----------
migration-package/04-winscp-update-capacity-leakage-period-concurrency
(That package is stale: missing manual-input flush fixes and an outdated embed.)

CRITICAL — avoid broken UI after upload
---------------------------------------
1) Upload public/capacity as ONE unit:
     embed.js + embed.css + ALL chunks/ files from THIS package.
   Do NOT mix chunks from an older package with a new embed.js
   (hashed filenames change every build — mixed sets = blank/broken Capacity).

2) Transfer mode: Binary (not Text).

3) Prefer: delete remote public/capacity/chunks/* first, then upload this
   package's chunks folder, then embed.js / embed.css.
   Or overwrite the entire public/capacity folder from this package.

4) Server `npm run build` often does NOT rebuild the Capacity embed.
   The prebuilt public/capacity in this package is required.

What this fixes
---------------
A) Manual table cells (Staffing Plan, DBE)
   - Enter / Tab / blur commit with live input value (no stale drafts)
   - Immediate MariaDB flush on cell commit (staffing_plan + capacity_documents)
   - DBE lines flush on save (no 800ms-only debounce left hanging)
   - Actual shrinkage / support HC flush immediately like other Actual cells

B) Period / Leakage / templates / concurrency / DBE HC
   - Monthly chips only from plan weeks; no invented years
   - Leakage multi-client FTE sums; missing Required FTE banner
   - Template column/field errors; concurrency refresh message
   - DBE Financial Summary: "Not in Staffing Plan" when HC missing

-----------------------------------------------------
1) WinSCP upload (Binary, overwrite)
-----------------------------------------------------
A) REQUIRED — built embed (whole folder together):
  public/capacity/embed.js
  public/capacity/embed.css
  public/capacity/chunks/     ← ALL .js files from this package
  public/capacity/            ← logos/avatars/icons if present (safe to overwrite)

B) Source (mirror paths under repo root):
  capacity/src/planner/capacityPeriod.ts
  capacity/src/components/planner/CapacityPeriodFilter.tsx
  capacity/src/components/planner/CapacityMatrixCellInput.tsx
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/pages/CapacitySummaryPage.tsx
  capacity/src/pages/LeakagePage.tsx
  capacity/src/pages/DbePage.tsx
  capacity/src/planner/dbe/staffingDbeLeakage.ts
  capacity/src/planner/dbe/dbePersistence.ts
  capacity/src/planner/capacityManualInputTemplate.ts
  capacity/src/planner/capacityForecastImport.ts
  capacity/src/planner/ledgerPersistence.ts
  capacity/src/planner/capacityPlanOverridePersistence.ts
  capacity/src/data/capacityDocuments.ts
  capacity/src/data/staffingPlanSync.ts
  capacity/src/context/PlannerContext.tsx
  capacity/src/hooks/useSheetCellDrafts.ts
  capacity/src/components/dbe/DbeFinancialSummaryPanel.tsx
  capacity/src/components/dbe/DbeSheetCellInput.tsx
  capacity/src/components/dbe/DbeSoftDecimalInput.tsx
  capacity/src/index.css

Remote destination example:
  /var/www/Data_Quality_Tool/...
  (keep the same relative paths as in this package)

-----------------------------------------------------
2) Rebuild + restart (repo ROOT on server)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool
  Then hard-refresh browser: Ctrl+F5

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  [ ] Staffing Plan cell: type → Tab/Enter/blur → value sticks after refresh
  [ ] DBE metric / cost cell: same; save badge shows saved (not stuck error)
  [ ] Leakage multi-client FTE chart; missing Required FTE banner
  [ ] Monthly period: only plan months
  [ ] No console chunk-404 for /capacity/chunks/*.js
