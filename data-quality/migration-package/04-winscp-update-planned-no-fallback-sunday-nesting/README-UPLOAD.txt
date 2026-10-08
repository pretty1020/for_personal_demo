WinSCP — FTE MariaDB persist + planned no-fallback + Sunday + nesting phone
==========================================================================
Upload CONTENTS of this folder to the app root.

SQLyog (if not already run):
  01-sqlyog/014_staffing_plan_planned_override.sql
  01-sqlyog/015_staffing_plan_actual_override.sql
  01-sqlyog/016_staffing_plan_fte_backfill.sql   <-- fills NULL FTE from JSON

PuTTY:
  npm run build
  pm2 restart data-quality-tool

Then open the Capacity plan, click Save (or re-upload template), and re-query:
  SELECT week_start, required_production_fte, production_fte,
         JSON_EXTRACT(planned_override_json,'$.callVolume') AS volume,
         updated_at
    FROM staffing_plan
   ORDER BY updated_at DESC LIMIT 50;