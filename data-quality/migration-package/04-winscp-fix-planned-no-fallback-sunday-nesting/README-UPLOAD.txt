WinSCP — planned no-fallback + overwrite Actuals + Sunday week start + nesting phone ramp
=========================================================================================
THIS PACKAGE SUPERSEDES: 04-winscp-fix-actual-weeks-preserve
(Overwrite now replaces Actuals for weeks in the file; Append still merges blank cells only.)

Prerequisites (already done if you ran earlier updates — skip if already applied)
---------------------------------------------------------------------------------
SQLyog once:
  migration-package/01-sqlyog/014_staffing_plan_planned_override.sql
  migration-package/01-sqlyog/015_staffing_plan_actual_override.sql

WinSCP upload (avoid broken embeds)
-----------------------------------
1. Open the SERVER app root (e.g. /var/www/Data_Quality_Tool).
2. Upload the CONTENTS of THIS folder (not the folder name itself).
3. Overwrite when prompted.
4. CRITICAL — upload the FULL public/capacity/ tree together:
     - public/capacity/embed.js
     - public/capacity/embed.css
     - public/capacity/chunks/*  (all hashed files in this package)
   Do NOT upload embed.js alone. Hashed chunk names changed; a partial
   chunks upload makes the Capacity UI fail to load after refresh.
5. Optional cleanup: delete obsolete chunk files listed at the bottom of MANIFEST.txt
   (safe to leave; they are unused once the new embed.js is live).
6. Do NOT upload older 04-winscp-fix-* packages after this one — they will regress the UI.

PuTTY
-----
  cd /var/www/Data_Quality_Tool
  npm run build
  pm2 restart data-quality-tool

Notes:
- On the server, vite is usually NOT installed. prebuild verifies the uploaded
  public/capacity embed and skips rebuilding it (see scripts/build-capacity-embed.mjs).
- If build says "Capacity embed is incomplete — missing chunks", re-upload the
  entire public/capacity folder from this package, then rebuild.
- Hard refresh the browser (Ctrl+Shift+R) after restart.

What this update does
---------------------
- Planned weeks: no invented volume/AHT/occupancy/attrition from simulation/assumptions.
- Upload Overwrite: replaces Actuals for weeks present in the file.
- Week start: Sunday only (no Monday option).
- Nesting weeks N => N Nesting Phone Time (%) fields (setup + Plan settings / Training timeline).