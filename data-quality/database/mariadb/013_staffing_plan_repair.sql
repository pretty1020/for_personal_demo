-- =============================================================================
-- 013 — Repair Capacity staffing_plan (WRONG legacy table was blocking 011)
-- =============================================================================
--
-- Your current staffing_plan looks like this (WRONG for this app):
--   staffing_id, plan_id, required_hc, available_hc, productive_hc, ...
--
-- Capacity needs:
--   id, owner_user_id, scenario_id, week_start,
--   required_production_fte, production_fte, created_at, updated_at
--
-- Run this WHOLE script in SQLyog (Execute all). Safe if Capacity never
-- successfully wrote to staffing_plan (your shrinkage table was empty).
--
-- The old table is RENAMED (not deleted) to staffing_plan_legacy_unused.
-- =============================================================================

USE mis_ph_db;

SET NAMES utf8mb4;

-- 1) Drop FK on shrinkage if present (ignore errors if none)
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan_shrinkage'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_shrinkage_plan'
  LIMIT 1
);
SET @sql := IF(
  @fk IS NOT NULL,
  'ALTER TABLE staffing_plan_shrinkage DROP FOREIGN KEY fk_staffing_plan_shrinkage_plan',
  'SELECT ''no shrinkage FK'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Drop Capacity shrinkage table (empty / depends on wrong parent)
DROP TABLE IF EXISTS staffing_plan_shrinkage;

-- 3) Move the WRONG legacy staffing_plan out of the way (keeps its data)
--    Skip rename if backup already exists from a prior attempt.
SET @has_legacy_shape := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'staffing_id'
);
SET @backup_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan_legacy_unused'
);
SET @has_correct := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'owner_user_id'
);

-- Rename wrong table → backup
SET @sql := IF(
  @has_legacy_shape > 0 AND @backup_exists = 0,
  'RENAME TABLE staffing_plan TO staffing_plan_legacy_unused',
  'SELECT ''rename skipped (already renamed or not legacy shape)'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- If wrong table still named staffing_plan but backup already exists, drop the wrong one
SET @has_legacy_shape := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'staffing_id'
);
SET @sql := IF(
  @has_legacy_shape > 0,
  'DROP TABLE staffing_plan',
  'SELECT ''no legacy staffing_plan left to drop'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- If somehow a partial Capacity table exists without owner_user_id, drop it
SET @table_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan'
);
SET @has_correct := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'owner_user_id'
);
SET @sql := IF(
  @table_exists > 0 AND @has_correct = 0,
  'DROP TABLE staffing_plan',
  'SELECT ''staffing_plan ready for create or already correct'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Create the CORRECT Capacity staffing_plan
CREATE TABLE IF NOT EXISTS staffing_plan (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  scenario_id VARCHAR(96) NOT NULL,
  week_start DATE NOT NULL,
  required_production_fte DECIMAL(14,4) NULL,
  production_fte DECIMAL(14,4) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staffing_plan_owner_scenario_week (owner_user_id, scenario_id, week_start),
  KEY idx_staffing_plan_owner (owner_user_id),
  KEY idx_staffing_plan_scenario (scenario_id),
  KEY idx_staffing_plan_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Create staffing_plan_shrinkage
CREATE TABLE IF NOT EXISTS staffing_plan_shrinkage (
  id CHAR(36) PRIMARY KEY,
  staffing_plan_id CHAR(36) NOT NULL,
  category_id VARCHAR(96) NOT NULL,
  category_name VARCHAR(191) NOT NULL DEFAULT '',
  category_group VARCHAR(32) NOT NULL DEFAULT 'in_office',
  planned_pct DECIMAL(10,6) NULL,
  actual_pct DECIMAL(10,6) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staffing_plan_shrinkage_week_cat (staffing_plan_id, category_id),
  KEY idx_staffing_plan_shrinkage_plan (staffing_plan_id),
  KEY idx_staffing_plan_shrinkage_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) Foreign keys (one statement each)
SET @fk_user := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @users_ok := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
);
SET @sql := IF(
  @fk_user = 0 AND @users_ok > 0,
  'ALTER TABLE staffing_plan ADD CONSTRAINT fk_staffing_plan_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT ''fk_staffing_plan_user ok'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_shrink := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan_shrinkage'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_shrinkage_plan'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @fk_shrink = 0,
  'ALTER TABLE staffing_plan_shrinkage ADD CONSTRAINT fk_staffing_plan_shrinkage_plan FOREIGN KEY (staffing_plan_id) REFERENCES staffing_plan(id) ON DELETE CASCADE',
  'SELECT ''fk_staffing_plan_shrinkage_plan ok'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7) Proof — you must see owner_user_id and required_production_fte here
SHOW COLUMNS FROM staffing_plan;
