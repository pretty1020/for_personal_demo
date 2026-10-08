WinSCP update - upload these files onto the existing app
=======================================================

This folder is NOT a full deployment. It holds only the files this change
touched, in the same layout they have on the server, so you can drop them
straight on top of the app folder.

1. In WinSCP, open the app folder on the server, e.g.
     /var/www/Data_Quality_Tool

2. Drag the CONTENTS of this folder (capacity/, public/, ...) onto it and
   let WinSCP overwrite. Keep the folder structure - do not flatten it.
   MANIFEST.txt and this file are notes for you; they do not need to go up.

3. public/capacity/embed.js is the file that must not be skipped. This
   package includes embed.js, embed.css, and EVERY file under
   public/capacity/chunks/ (not only the ones named in embed.js). Partial
   chunk uploads cause blank Capacity pages / "Failed to fetch dynamically
   imported module" errors after rebuild. Hard-refresh once after deploy.

4. SQL changed in this update. In SQLyog run:
     migration-package/01-sqlyog/011_staffing_plan.sql
   (or database/mariadb/011_staffing_plan.sql from this package).
   That creates staffing_plan.required_hc for Required Production FTE.

5. Rebuild, then restart, in PuTTY:
     cd /var/www/Data_Quality_Tool
     npm run build
     pm2 restart data-quality-tool     # or: npm run start
   The Capacity embed is prebuilt and included above, so the build reuses
   it rather than needing capacity/vite on the server. If chunks are
   incomplete, prebuild now fails early with the missing filenames.

Old files this update replaces:
  public/capacity/chunks/AdvancedStaffingCapacityPlanPage-C1nycgAB.js
  public/capacity/chunks/capacityImportWeek-HLOloQ1o.js
  public/capacity/chunks/capacityMatrixDisplay-DDzzeU3S.js
  public/capacity/chunks/CapacityPeriodFilter-CcJPoPW1.js
  public/capacity/chunks/capacityPlanDerived-CGo5-H_Z.js
  public/capacity/chunks/CapacityPlanSettingsPage-BxisYdvX.js
  public/capacity/chunks/capacityPortfolio-C-vIBTnJ.js
  public/capacity/chunks/CapacitySetupWizardPage-D6dUdPL2.js
  public/capacity/chunks/CapacitySignInForm-Cd0hBBhg.js
  public/capacity/chunks/CapacitySignInPage-daoWscLs.js
  public/capacity/chunks/CapacitySummaryPage-DRFxPSwW.js
  public/capacity/chunks/clientRegistry-DXLBeIng.js
  public/capacity/chunks/companyHierarchy-DSYtgtHq.js
  public/capacity/chunks/dbeExport-DKktf59t.js
  public/capacity/chunks/DbePage-BgqXxB5o.js
  public/capacity/chunks/dbePersistence-BGY6IY0k.js
  public/capacity/chunks/DemoAccessPage-C7HNGy2v.js
  public/capacity/chunks/esm-qaRK8lQV.js
  public/capacity/chunks/format-BwlCifxO.js
  public/capacity/chunks/formulaOverrides-CelK4f8f.js
  public/capacity/chunks/FormulaReferencePage-C_TwlJam.js
  public/capacity/chunks/LeakagePage-B6hSpLGO.js
  public/capacity/chunks/ModulePageHeader-D1yoXA7Q.js
  public/capacity/chunks/planIdentity-BJ0kD2ML.js
  public/capacity/chunks/PlanStartWeekField-BXwA-bFA.js
  public/capacity/chunks/UserManagementPage-pZfJlf-5.js
They are no longer referenced. Delete them to keep the folder tidy, or
leave them - nothing loads them once the new embed.js is in place.

If the Capacity pages show a blank panel or a module error afterwards, the
browser is holding a stale embed.js. A hard reload (Ctrl+F5) settles it; the
app also detects a stale chunk and reloads itself once.
