SUPERSEDED — do not upload this package
=======================================

Use instead:
  migration-package/04-winscp-update-capacity-manual-input-mariadb/

Why this package is unsafe to upload now
----------------------------------------
1) capacity/src/data/capacityDocuments.ts is missing flushCapacityDocumentKey
   (manual cell / DBE commits would not flush MariaDB documents immediately).
2) Manual-input source files are not included
   (DbeSheetCellInput, useSheetCellDrafts, ledgerPersistence, PlannerContext, etc.).
3) public/capacity embed hashes are older than the current build —
   mixing with a newer embed.js from elsewhere will 404 chunks.

Upload only:
  04-winscp-update-capacity-manual-input-mariadb
(with Binary mode; replace entire public/capacity together).
