WinSCP — Capacity Plan persistence (COMPLETE package)
=====================================================

USE THIS PACKAGE ONLY. Do not also upload:
  04-winscp-update-capacity-persist-admin
  04-winscp-update-capacity-upload-accuracy
Those are incomplete / stale and can overwrite good files.

Does NOT change Data Quality.

-----------------------------------------------------
1) SQLyog FIRST (do not WinSCP this into the app tree)
-----------------------------------------------------
Run once (safe to re-run; does not delete rows):

  _sqlyog-do-not-upload/024_capacity_plan_input_persistence.sql

(Also mirrored in migration-package/01-sqlyog/)

Skip only if you already have:
  staffing_plan.planned_override_json
  staffing_plan.actual_override_json
  staffing_plan.required_production_fte / production_fte
  table staffing_plan_shrinkage

-----------------------------------------------------
2) WinSCP upload (Binary mode, merge/overwrite)
-----------------------------------------------------
Upload the capacity/ folder into the app root so these land:

  capacity/api/_lib/staffingPlanStore.ts
  capacity/src/components/planner/ChannelSelector.tsx
  capacity/src/context/PlannerContext.tsx
  capacity/src/data/capacityDocuments.ts
  capacity/src/data/staffingPlanSync.ts
  capacity/src/pages/AdvancedStaffingCapacityPlanPage.tsx
  capacity/src/pages/CapacityPlanSettingsPage.tsx
  capacity/src/pages/CapacitySetupWizardPage.tsx
  capacity/src/planner/capacityLookup.ts
  capacity/src/planner/capacityManualInputTemplate.ts
  capacity/src/planner/capacityPlanDerived.ts
  capacity/src/planner/capacityPlanOverridePersistence.ts
  capacity/src/planner/ledgerPersistence.ts

Do NOT upload _sqlyog-do-not-upload/ via WinSCP into the app.

-----------------------------------------------------
3) Rebuild + restart (repo ROOT, not capacity/ only)
-----------------------------------------------------
  npm run build
  pm2 restart data-quality-tool

(prebuild rebuilds public/capacity embed; Next serves API + UI)

-----------------------------------------------------
4) Verify
-----------------------------------------------------
  - Template upload: Volume/AHT/Occupancy/FTE/shrinkage show and survive refresh
  - Manual cell edit survives refresh
  - Create New Client: Supported Channel Next shows why blocked
  - Plan Settings: Channel editable; Admin can edit/delete
