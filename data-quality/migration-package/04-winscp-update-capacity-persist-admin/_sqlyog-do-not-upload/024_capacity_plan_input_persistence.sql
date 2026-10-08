-- 024_capacity_plan_input_persistence.sql
-- Capacity Plan: ensure staffing_plan captures all manual cell inputs.
-- Does NOT touch Data Quality tables. Does NOT delete existing rows.
-- Safe to re-run.
--
-- Durable stores:
--   staffing_plan.required_production_fte / production_fte
--   staffing_plan.planned_override_json  (volume, AHT, occupancy, HC drivers, support HC, …)
--   staffing_plan.actual_override_json
--   staffing_plan_shrinkage (planned_pct / actual_pct per category)
--   capacity_documents (scenario JSON, including supportedChannels / LOB settings)
--
-- Input data must not rely on localStorage / workspace_state.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Guard tables
SET @sp := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan'
);
SET @docs := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'capacity_documents'
);

SET @g1 := IF(
  @sp = 0,
  'SELECT ''ERROR: staffing_plan missing — run 011/012 first'' AS error',
  'SELECT ''staffing_plan present'' AS info'
);
PREPARE g1 FROM @g1; EXECUTE g1; DEALLOCATE PREPARE g1;

SET @g2 := IF(
  @docs = 0,
  'SELECT ''WARN: capacity_documents missing — run 007_capacity_documents.sql'' AS warning',
  'SELECT ''capacity_documents present'' AS info'
);
PREPARE g2 FROM @g2; EXECUTE g2; DEALLOCATE PREPARE g2;

-- planned_override_json
SET @c1 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'planned_override_json'
);
SET @s1 := IF(
  @sp > 0 AND @c1 = 0,
  'ALTER TABLE staffing_plan ADD COLUMN planned_override_json JSON NULL',
  'SELECT ''planned_override_json ok'' AS info'
);
PREPARE s1 FROM @s1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- actual_override_json
SET @c2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'actual_override_json'
);
SET @s2 := IF(
  @sp > 0 AND @c2 = 0,
  'ALTER TABLE staffing_plan ADD COLUMN actual_override_json JSON NULL',
  'SELECT ''actual_override_json ok'' AS info'
);
PREPARE s2 FROM @s2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- Ensure FTE columns exist (normalized names)
SET @c3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'required_production_fte'
);
SET @s3 := IF(
  @sp > 0 AND @c3 = 0,
  'ALTER TABLE staffing_plan ADD COLUMN required_production_fte DECIMAL(14,4) NULL',
  'SELECT ''required_production_fte ok'' AS info'
);
PREPARE s3 FROM @s3; EXECUTE s3; DEALLOCATE PREPARE s3;

SET @c4 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'production_fte'
);
SET @s4 := IF(
  @sp > 0 AND @c4 = 0,
  'ALTER TABLE staffing_plan ADD COLUMN production_fte DECIMAL(14,4) NULL',
  'SELECT ''production_fte ok'' AS info'
);
PREPARE s4 FROM @s4; EXECUTE s4; DEALLOCATE PREPARE s4;

-- Shrinkage child table
CREATE TABLE IF NOT EXISTS staffing_plan_shrinkage (
  id CHAR(36) PRIMARY KEY,
  staffing_plan_id CHAR(36) NOT NULL,
  category_id VARCHAR(96) NOT NULL,
  category_name VARCHAR(255) NOT NULL,
  category_group VARCHAR(64) NOT NULL DEFAULT 'in_office',
  planned_pct DECIMAL(10,6) NULL,
  actual_pct DECIMAL(10,6) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sps_plan_cat (staffing_plan_id, category_id),
  KEY idx_sps_plan (staffing_plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '024_capacity_plan_input_persistence complete — existing rows preserved' AS info;
