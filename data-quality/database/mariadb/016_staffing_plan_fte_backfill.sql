-- Backfill Required / Production FTE columns from planned_override_json when columns are NULL.
-- Also verifies staffing_plan schema columns exist.
--
-- Run in SQLyog AFTER 011–015. Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Ensure JSON columns exist (no-op if already applied).
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'planned_override_json'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE staffing_plan ADD COLUMN planned_override_json JSON NULL AFTER production_fte',
  'SELECT ''planned_override_json present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'actual_override_json'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE staffing_plan ADD COLUMN actual_override_json JSON NULL AFTER planned_override_json',
  'SELECT ''actual_override_json present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill required_production_fte from JSON.
UPDATE staffing_plan
   SET required_production_fte = CAST(
         JSON_UNQUOTE(JSON_EXTRACT(planned_override_json, '$.requiredFte')) AS DECIMAL(14,4)
       )
 WHERE required_production_fte IS NULL
   AND planned_override_json IS NOT NULL
   AND JSON_EXTRACT(planned_override_json, '$.requiredFte') IS NOT NULL
   AND JSON_TYPE(JSON_EXTRACT(planned_override_json, '$.requiredFte')) <> 'NULL';

-- Backfill production_fte from JSON.
UPDATE staffing_plan
   SET production_fte = CAST(
         JSON_UNQUOTE(JSON_EXTRACT(planned_override_json, '$.productionFte')) AS DECIMAL(14,4)
       )
 WHERE production_fte IS NULL
   AND planned_override_json IS NOT NULL
   AND JSON_EXTRACT(planned_override_json, '$.productionFte') IS NOT NULL
   AND JSON_TYPE(JSON_EXTRACT(planned_override_json, '$.productionFte')) <> 'NULL';

-- Sanity check query (run separately to inspect):
-- SELECT owner_user_id, scenario_id, week_start,
--        required_production_fte, production_fte,
--        JSON_EXTRACT(planned_override_json, '$.callVolume') AS volume,
--        JSON_EXTRACT(planned_override_json, '$.requiredFte') AS json_required_fte,
--        updated_at
--   FROM staffing_plan
--  ORDER BY updated_at DESC
--  LIMIT 50;
