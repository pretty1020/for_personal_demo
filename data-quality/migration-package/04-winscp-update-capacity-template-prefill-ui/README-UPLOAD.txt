WinSCP — Capacity Staffing Plan template prefill + UI
=====================================================

Does NOT change Data Quality.
No new SQL.

USE THIS PACKAGE AS ONE UNIT. Do not cherry-pick files.

-----------------------------------------------------
Required upload set (Binary, merge/overwrite into app root)
-----------------------------------------------------
Upload the package `capacity/` folder so these land together:

  capacity/src/planner/capacityManualInputTemplate.ts
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/context/PlannerContext.tsx
  capacity/src/index.css

Atomic pairs (partial upload breaks behavior):
  - AdvancedStaffingCapacityPlanPage.tsx REQUIRES capacityManualInputTemplate.ts
    (imports buildDerivedPrefillByWeek — missing file → build fail)
  - PlannerContext.tsx REQUIRED for Overwrite planned weeks to replace (not merge leftovers)
  - index.css is UI-only (layout polish); app runs without it but looks unchanged

Do NOT upload:
  - capacityManualInputTemplate.test.ts (dev tests only; optional)
  - README-UPLOAD.txt into the app tree
  - This whole package nested as a subfolder (merge into app root capacity/)

Do NOT also re-upload older Capacity packages after this
(e.g. 04-winscp-update-capacity-persist-admin / upload-accuracy) — they can
overwrite these files with stale copies.

WinSCP settings:
  - Transfer mode = Binary
  - Overwrite when asked
  - After upload, confirm remote paths exist under capacity/src/...

-----------------------------------------------------
Rebuild + restart (repo ROOT, not capacity/ alone)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

(prebuild rebuilds the Capacity embed into public/capacity/)

If build fails on buildDerivedPrefillByWeek / capacityManualInputTemplate,
the planner file was uploaded without the updated template module.

-----------------------------------------------------
Verify
-----------------------------------------------------
  - Single LOB selected → File → Download input template (with current data)
    → Excel has Planned + Actual values for weeks on the plan (not blank)
  - Append / merge: blanks fill; Volume/AHT/Occupancy update from file
  - Overwrite: weeks present in the file replace Planned/Actual for those weeks
  - Staffing Plan meta bar / matrix spacing looks clearer
