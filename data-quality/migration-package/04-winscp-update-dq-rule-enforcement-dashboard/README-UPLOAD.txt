WinSCP — DQ rule enforcement + Dashboard rule charts
====================================================

Does NOT change Capacity.

USE THIS PACKAGE AS ONE UNIT. Do not cherry-pick files — partial upload breaks the build
(e.g. validate.ts without active-rules.ts → Cannot find module '@/lib/validation/active-rules').

-----------------------------------------------------
1) SQLyog FIRST (schema indexes / is_critical comment)
-----------------------------------------------------
Run once (safe to re-run; does not delete data):

  _sqlyog-do-not-upload/025_dq_checklist_rule_enforcement.sql

Also in: migration-package/01-sqlyog/

Before running, confirm:
  SELECT DATABASE();   -- expect mis_ph_db (or change USE in the script)

Notes:
  - App code still works if 025 is delayed (indexes are for dashboard query speed).
  - Do NOT WinSCP-upload _sqlyog-do-not-upload/ into the app tree.
  - Optional: copy database/mariadb/025_*.sql to the server repo for parity only — it does not apply schema.

-----------------------------------------------------
2) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload the package `src/` folder into the app root so these land together:

  src/lib/validation/active-rules.ts          ← NEW (required with validate.ts)
  src/lib/validation/types.ts
  src/lib/validation/validate.ts
  src/lib/validation/pivot.ts                 ← stricter detector; skip when rule absent
  src/lib/checklist-eval.ts
  src/lib/services/mariadb-validation.ts
  src/lib/standalone/run-validation.ts
  src/lib/dashboard-payload.ts
  src/lib/mariadb/repository.ts
  src/app/api/dashboard/route.ts
  src/app/api/exports/dashboard/route.ts
  src/app/(main)/dashboard/page.tsx

Atomic sets (if you must stage):
  Enforcement: active-rules + types + validate + mariadb-validation + run-validation (+ checklist-eval)
  Dashboard:   dashboard-payload + repository + api/dashboard + api/exports/dashboard + (main)/dashboard/page

WinSCP hazards:
  - Transfer mode = Binary
  - Overwrite when asked
  - Keep the literal folder name (main) — parentheses must remain
  - After upload, verify remote path exists:
      .../src/app/(main)/dashboard/page.tsx
  - Do not nest the package folder (upload contents into app root, not a subfolder named
    04-winscp-update-dq-rule-enforcement-dashboard)
  - Do not upload README-UPLOAD.txt or _sqlyog-do-not-upload/

-----------------------------------------------------
3) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

If build fails on '@/lib/validation/active-rules', the new file was not uploaded.

-----------------------------------------------------
4) Verify
-----------------------------------------------------
  - Remove no_pivot_format (Pivot) from a workflow → pivot layout no longer blocks that workflow
  - Mark a rule non-critical → warning only; validation can still pass
  - Dashboard: Audit rule performance chart + filterable Rule-check results table
  - Export CSV includes rule_checks_total / rule_checks_failed
