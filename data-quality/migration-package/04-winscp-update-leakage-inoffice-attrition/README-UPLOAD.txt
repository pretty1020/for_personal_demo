WinSCP — Leakage: In-office shrinkage + Attrition accuracy
==========================================================

What this fixes
---------------
1) Leakage In-office shrinkage and Attrition now score correctly on Actual weeks
   (including elapsed forward-plan weeks, not only timeline=historical_actual).
2) In-office and Absenteeism buckets are measured independently from category actuals.
3) In-office leakage includes Not Billable categories only (Break included when Not Billable;
   billable in-office time is excluded).
4) Staffing Plan Actual OOO / In-office shrinkage rows display and edit on statusLabel=Actual weeks.
5) Unmeasured attrition weeks no longer read as "0 leavers beat the plan".

-----------------------------------------------------
1) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload these paths into the app root (keep relative folders):

  capacity/src/planner/dbe/staffingDbeLeakage.ts
  capacity/src/pages/LeakagePage.tsx
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/planner/capacityMatrixDisplay.ts

Optional (tests only — not required on the server):
  capacity/src/planner/dbe/staffingDbeLeakage.test.ts

If also deploying presentation-ux, upload this package AFTER presentation-ux
(same AdvancedStaffingCapacityPlanPage.tsx — this copy is current).

-----------------------------------------------------
2) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  - Staffing Plan: on an Actual week, enter Actual in-office category % above Planned
  - Enter Actual production HC attrition above Planned
  - Open Leakage → In-office shrinkage and Attrition KPIs / columns show $ > 0
  - Billable Break / billable in-office overruns do not add to In-office leakage
  - Break tagged Not Billable does add to In-office leakage when Actual > Planned
