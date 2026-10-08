WinSCP update - upload persist + Out of Office defaults
=======================================================

Fixes:
- Uploaded staffing files flush to MariaDB immediately (weekly + monthly
  matrix keep values after refresh).
- Out of Office shrinkage defaults to Absenteeism and Vacation Leave
  breakdown rows in the matrix.

1. WinSCP: open /var/www/Data_Quality_Tool
2. Drag CONTENTS of this folder (capacity/, public/) onto it; overwrite.
3. Include ALL of public/capacity/chunks/ plus embed.js / embed.css.
4. PuTTY:
     cd /var/www/Data_Quality_Tool
     npm run build
     pm2 restart data-quality-tool
5. Hard-refresh the browser (Ctrl+Shift+R).

No new SQL for this change.
