WinSCP + SQLyog — preserve actual weeks; no fallback invented data
================================================================

1. SQLyog (if not already run):
   014_staffing_plan_planned_override.sql
   015_staffing_plan_actual_override.sql

2. WinSCP: upload CONTENTS of this folder onto the app root.

3. PuTTY: npm run build && pm2 restart data-quality-tool

4. Hard refresh. Re-upload if needed. Actual weeks are never deleted by
   template upload (only matching cells update; default mode is Append).
