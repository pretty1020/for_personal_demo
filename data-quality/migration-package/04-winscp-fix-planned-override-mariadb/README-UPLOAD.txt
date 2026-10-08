WinSCP update - planned weeks persist to MariaDB staffing_plan
==============================================================

Why data disappeared: template uploads only partially reached MariaDB
(staffing_plan had FTE/shrinkage only). Volume/AHT/occupancy/HC lived in
the browser cache / capacity_documents; if that flush raced or failed,
planned weeks looked empty after refresh. workspace_state is NOT written.

1. SQLyog — run once:
     migration-package/01-sqlyog/014_staffing_plan_planned_override.sql
   (also copied as 014_staffing_plan_planned_override.sql in this folder)

2. WinSCP — drag CONTENTS onto /var/www/Data_Quality_Tool (overwrite).
   Include ALL public/capacity/chunks/ + embed.js + embed.css.

3. PuTTY:
     cd /var/www/Data_Quality_Tool
     npm run build
     pm2 restart data-quality-tool

4. Hard-refresh (Ctrl+Shift+R). Re-upload the template once, then confirm:
     SELECT scenario_id, week_start, required_production_fte, production_fte,
            planned_override_json, updated_at
       FROM staffing_plan
      ORDER BY updated_at DESC LIMIT 20;
