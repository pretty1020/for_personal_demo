WinSCP — DQ fix: PIVOT_LAYOUT false positives + rule gating
===========================================================

Does NOT change Capacity.

Fixes:
  - Files no longer get PIVOT_LAYOUT when "No pivot / non-tabular format"
    (no_pivot_format) is NOT on the workflow checklist.
  - Detector no longer flags normal tabular files just because a cell/column
    contains the word "total" or the sheet is a modest numeric table.

-----------------------------------------------------
1) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload these three files into the app root (same relative paths):

  src/lib/validation/pivot.ts
  src/lib/validation/validate.ts
  src/lib/validation/active-rules.ts

Dependencies:
  - active-rules.ts must already exist on the server (from the earlier
    rule-enforcement package). If missing, upload this file too — it is
    included in this package.

WinSCP hazards:
  - Transfer mode = Binary
  - Overwrite when asked
  - Do not nest the package folder name under the app root

-----------------------------------------------------
2) Rebuild + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  - Workflow WITHOUT no_pivot_format → upload any file → no PIVOT_LAYOUT issue
  - Normal fact table with a "Total Amount" column → no PIVOT_LAYOUT
  - True pivot (Grand Total row + crosstab wording / wide matrix) can still flag
    only when the pivot rule is present on the workflow
