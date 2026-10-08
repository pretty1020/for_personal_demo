WinSCP — DBE Financial Summary: Planned Production HC from Staffing Plan
=======================================================================

What this fixes / adds
----------------------
1) Financial Summary captures Planned Production HC from the matched Staffing Plan
   (derived plan rows — last week of each month, same as Staffing Plan monthly Summary).
2) Displays Planned Production HC in:
   - Top KPI strip (avg month across the selected period)
   - Period breakdown table
   - Revenue comparison KPIs and tables (already present; kept)
3) Excel export includes a Financial_Comparison sheet with Planned Production HC
4) Matching still uses Client · LOB · Location · Project Code

-----------------------------------------------------
1) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload these paths into the app root (keep relative folders):

  capacity/src/components/dbe/DbeFinancialSummaryPanel.tsx
  capacity/src/planner/dbe/staffingMonthDrivers.ts
  capacity/src/planner/dbe/dbeExport.ts
  capacity/src/planner/dbe/dbeRevenueComparison.ts
  capacity/src/pages/DbePage.tsx
  capacity/src/index.css

If also deploying presentation-ux / leakage packages, upload this package LAST
(so its index.css KPI styles are not overwritten).

-----------------------------------------------------
2) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

Common deploy mistakes
----------------------
  - Text-only upload without rebuild → Capacity still serves old public/capacity chunks
  - Text mode instead of Binary → corrupted files
  - Uploading into the wrong folder (must keep capacity/src/... under the app root)
  - Skipping pm2 restart after build

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  - Open DBE → Financial summary for a client matched to a Staffing Plan
  - Top KPI "Planned Production HC" shows the Staffing Plan headcount (not —)
  - Period breakdown has a Planned Production HC column
  - Revenue comparison Planned Production HC matches Staffing Plan last-week HC for that month
  - Download Excel → Financial_Comparison sheet includes Planned Production HC
