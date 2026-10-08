WinSCP — Capacity Staffing Plan: premium UI + presentation PNG + delete persistence
==================================================================================

Does NOT change Data Quality core (except Capacity embed rebuild).

What this fixes / adds
----------------------
1) UI/UX polish on Staffing Plan (cleaner charts panel, meta chips, Download image CTA)
2) Presentation download:
   - Toolbar → "Download image" (charts + matrix PNG)
   - Charts → "Download charts PNG"
   - File menu → Matrix PNG / Presentation PNG
3) Cleared / deleted cell values now sync to MariaDB so they stay gone after refresh
   (empty planned/actual overrides are pushed; FTE columns clear when planned is emptied)
4) Manual cell edits now commit on Enter / Tab / blur (was reverting to the previous value)
5) Includes latest Actual-week shrinkage display fixes (synced with leakage package)

-----------------------------------------------------
1) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload these paths into the app root (keep relative folders):

  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/components/planner/CapacityMatrixCellInput.tsx   ← cell Enter/Tab fix
  capacity/src/components/staffing/StaffingCapacityChartsPanel.tsx
  capacity/src/planner/capacityPresentationExport.ts   ← NEW
  capacity/src/context/PlannerContext.tsx
  capacity/src/planner/ledgerPersistence.ts
  capacity/src/data/staffingPlanSync.ts
  capacity/api/_lib/staffingPlanStore.ts
  capacity/src/index.css

html2canvas is already in capacity/package.json — no npm install needed if deps are current.
If build complains about html2canvas: run `npm install` inside `capacity/`.

UPLOAD ORDER (if deploying several 04- packages together)
---------------------------------------------------------
1) 04-winscp-update-capacity-presentation-ux   (this package)
2) 04-winscp-update-leakage-inoffice-attrition
3) 04-winscp-update-dbe-financial-planned-hc   (last — owns latest index.css KPI styles)

Do not re-upload an older 04- package after these, or it can overwrite newer shared files
(AdvancedStaffingCapacityPlanPage.tsx / index.css).

-----------------------------------------------------
2) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  - Edit an editable Planned/Actual cell → Enter or Tab → value stays as typed
  - Clear an editable Planned/Actual cell → Save or blur → refresh → value stays blank
  - Open Charts → Download charts PNG
  - Toolbar Download image → PNG includes charts + matrix
  - File → Presentation PNG / Matrix PNG
