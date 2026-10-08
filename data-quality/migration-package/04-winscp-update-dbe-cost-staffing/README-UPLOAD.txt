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

4. No SQL to run. Nothing in this update changes the database schema.

5. No rebuild needed: nothing here is compiled by `npm run build`. The
   Capacity embed ships prebuilt and public/ is served straight from disk.
   Restart so the new chunk filenames are picked up, in PuTTY:
     cd /var/www/Data_Quality_Tool
     pm2 restart data-quality-tool     # or stop and: npm run start
   Running `npm run build` anyway is harmless if you prefer.

Old files this update replaces:
  public/capacity/chunks/AdvancedStaffingCapacityPlanPage-z3al6SG6.js
  public/capacity/chunks/CapacityPeriodFilter-USLDRHct.js
  public/capacity/chunks/capacityPortfolio-D02xvlSn.js
  public/capacity/chunks/CapacitySummaryPage-DnoKgQpD.js
  public/capacity/chunks/dbeExport-fhvntaZk.js
  public/capacity/chunks/DbePage-DkVin2TM.js
  public/capacity/chunks/dbePersistence-BN5BGF_m.js
  public/capacity/chunks/LeakagePage-DvIBwpol.js
They are no longer referenced. Delete them to keep the folder tidy, or
leave them - nothing loads them once the new embed.js is in place.

If the Capacity pages show a blank panel or a module error afterwards, the
browser is holding a stale embed.js. A hard reload (Ctrl+F5) settles it; the
app also detects a stale chunk and reloads itself once.
