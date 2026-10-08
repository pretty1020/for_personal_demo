-- Normalize staffing_plan column names and add staffing_plan_shrinkage.
-- Renames required_hc → required_production_fte, production_hc → production_fte.
-- Persists Shrinkage Breakdown outside workspace_state / document JSON blobs.
--
-- Run in SQLyog AFTER 011_staffing_plan.sql (or after creating staffing_plan).
-- Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Ensure base table exists (idempotent with 011).
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

-- Rename legacy required_hc → required_production_fte when present.
SET @has_required_hc := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'required_hc'
);
SET @has_required_production_fte := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'required_production_fte'
);
SET @sql := IF(
  @has_required_hc > 0 AND @has_required_production_fte = 0,
  'ALTER TABLE staffing_plan CHANGE COLUMN required_hc required_production_fte DECIMAL(14,4) NULL',
  'SELECT ''required_production_fte ready'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rename legacy production_hc → production_fte when present.
SET @has_production_hc := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'production_hc'
);
SET @has_production_fte := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'production_fte'
);
SET @sql := IF(
  @has_production_hc > 0 AND @has_production_fte = 0,
  'ALTER TABLE staffing_plan CHANGE COLUMN production_hc production_fte DECIMAL(14,4) NULL',
  'SELECT ''production_fte ready'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add columns if a partial table exists without them.
SET @has_required_production_fte := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'required_production_fte'
);
SET @sql := IF(
  @has_required_production_fte = 0,
  'ALTER TABLE staffing_plan ADD COLUMN required_production_fte DECIMAL(14,4) NULL AFTER week_start',
  'SELECT ''required_production_fte present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_production_fte := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffing_plan' AND COLUMN_NAME = 'production_fte'
);
SET @sql := IF(
  @has_production_fte = 0,
  'ALTER TABLE staffing_plan ADD COLUMN production_fte DECIMAL(14,4) NULL AFTER required_production_fte',
  'SELECT ''production_fte present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Shrinkage Breakdown: one row per category per staffing_plan week.
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

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan_shrinkage'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_shrinkage_plan'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE staffing_plan_shrinkage
     ADD CONSTRAINT fk_staffing_plan_shrinkage_plan
     FOREIGN KEY (staffing_plan_id) REFERENCES staffing_plan(id) ON DELETE CASCADE',
  'SELECT ''fk_staffing_plan_shrinkage_plan already present'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_user_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @users_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
);
SET @has_owner_user_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'owner_user_id'
);
-- One statement per PREPARE. Skip FK if owner_user_id is missing (legacy table → run 013).
SET @sql := IF(
  @fk_user_exists = 0 AND @users_exists > 0 AND @has_owner_user_id > 0,
  'ALTER TABLE staffing_plan ADD CONSTRAINT fk_staffing_plan_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT ''fk_staffing_plan_user skipped (already present, users missing, or no owner_user_id — run 013)'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
