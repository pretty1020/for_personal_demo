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
   package includes embed.js, embed.css, and EVERY chunk embed.js names,
   so a WinSCP overwrite cannot leave missing /chunks/*.js files.
   embed.js is served no-cache, so browsers pick it up without clearing cache.

4. SQL changed in this update. Run the scripts under database/mariadb/ in
   SQLyog before restarting the app. See 01-sqlyog/README-SQLyog.txt.

5. Rebuild, then restart, in PuTTY:
     cd /var/www/Data_Quality_Tool
     npm run build
     pm2 restart data-quality-tool     # or: npm run start
   The Capacity embed is prebuilt and included above, so the build reuses
   it rather than needing capacity build tools on the server.

Old files this update replaces:
  public/capacity/chunks/AdvancedStaffingCapacityPlanPage-Dx4-R9B_.js
  public/capacity/chunks/capacityDocuments-B54aa-4z.js
  public/capacity/chunks/capacityImportWeek-Fh5u2tNb.js
  public/capacity/chunks/capacityMatrixDisplay-DYWp2hyO.js
  public/capacity/chunks/CapacityPeriodFilter-BC7j0PjS.js
  public/capacity/chunks/capacityPlanDerived-DeRRJ7fI.js
  public/capacity/chunks/CapacityPlanSettingsPage-DtFIjE9f.js
  public/capacity/chunks/capacityPortfolio-CmtI0SD5.js
  public/capacity/chunks/CapacitySetupWizardPage-BlHqWCMq.js
  public/capacity/chunks/CapacitySignInForm-BukmSa9s.js
  public/capacity/chunks/CapacitySignInPage-CuvWPUeS.js
  public/capacity/chunks/CapacitySummaryPage-SAlerAFL.js
  public/capacity/chunks/companyHierarchy-a_TT9i3s.js
  public/capacity/chunks/dbeExport-BRMEo5Df.js
  public/capacity/chunks/DbePage-NNQSxLUC.js
  public/capacity/chunks/DemoAccessPage-C9tBJijE.js
  public/capacity/chunks/esm-vIUOoGk-.js
  public/capacity/chunks/FormulaReferencePage-DE2KygDa.js
  public/capacity/chunks/LeakagePage-D671A6CB.js
  public/capacity/chunks/ModulePageHeader-Hd40P3Hs.js
  public/capacity/chunks/PlanStartWeekField-BzIOMFoE.js
  public/capacity/chunks/staffingPlanSync-CtLknYTB.js
  public/capacity/chunks/UserManagementPage-C0cOqssk.js
They are no longer referenced. Delete them to keep the folder tidy, or
leave them - nothing loads them once the new embed.js is in place.

If the Capacity pages show a blank panel or a module error afterwards, the
browser is holding a stale embed.js. A hard reload (Ctrl+F5) settles it; the
app also detects a stale chunk and reloads itself once.
