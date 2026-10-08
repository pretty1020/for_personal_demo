WinSCP — Capacity: Next button (all channels) + Download Template Actual weeks
==============================================================================

Does NOT change Data Quality.

Fixes:
  1) Client Creation → Requirement Drivers: Next works for Voice, Chat, Email,
     and Blended/Custom (no longer stuck when a non-Voice channel is selected).
  2) Download Input Template includes ALL Actual weeks (matrix + stored overrides),
     not a partial / blank Actual set.

-----------------------------------------------------
1) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload the package `capacity/src/` tree into the app so these land together:

  capacity/src/pages/CapacitySetupWizardPage.tsx
  capacity/src/components/planner/ChannelCapacityDriversPanel.tsx
  capacity/src/planner/channelPlanning.ts
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/planner/capacityManualInputTemplate.ts

Optional (tests only — not required on server):
  capacity/src/planner/capacityManualInputTemplate.test.ts

WinSCP hazards:
  - Transfer mode = Binary
  - Overwrite when asked
  - Do not nest the package folder name under the app root

-----------------------------------------------------
2) Rebuild Capacity embed + restart (repo ROOT)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

(If your deploy only rebuilds capacity:)
  npm run build:capacity-embed
  npm run build
  pm2 restart data-quality-tool

-----------------------------------------------------
3) Verify
-----------------------------------------------------
  - Create client → pick Chat / Email / Blended → Requirement Drivers → Next enabled
  - Download Input Template → Actual columns populated for every Actual week in the plan
