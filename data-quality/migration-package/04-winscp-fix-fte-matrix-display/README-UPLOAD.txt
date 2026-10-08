WinSCP update - upload these files onto the existing app
=======================================================

This folder is NOT a full deployment. It holds only the files this change
touched, in the same layout they have on the server, so you can drop them
straight on top of the app folder.

Fix: Required Production FTE was hidden after refresh when Production FTE
was missing (weekly mutual blank). Production FTE is now persisted to
staffing_plan.production_fte on Save and restored on hydrate.

1. In WinSCP, open the app folder on the server, e.g.
     /var/www/Data_Quality_Tool

2. Drag the CONTENTS of this folder (capacity/, public/, ...) onto it and
   let WinSCP overwrite. Keep the folder structure - do not flatten it.
   MANIFEST.txt and this file are notes for you; they do not need to go up.

3. public/capacity/embed.js is the file that must not be skipped. This
   package includes embed.js, embed.css, and EVERY file under
   public/capacity/chunks/. Hard-refresh once after deploy (Ctrl+Shift+R).

4. No new SQL for this fix. staffing_plan already has production_fte.

5. Rebuild, then restart, in PuTTY:
     cd /var/www/Data_Quality_Tool
     npm run build
     pm2 restart data-quality-tool     # or: npm run start

6. After deploy: open Staffing Plan, confirm Required Production FTE shows
   for weeks that have 30 in staffing_plan. Click Save once so Production
   FTE is written when HC derives a value; re-check production_fte in SQL.
