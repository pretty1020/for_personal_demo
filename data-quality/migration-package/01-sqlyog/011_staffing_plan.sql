-- Staffing Plan week metrics — Required Production FTE and Production FTE.
-- Persists business-critical headcount outside workspace_state / document JSON blobs.
--
-- Run in SQLyog AFTER 007_capacity_documents.sql.
-- Safe to re-run (IF NOT EXISTS / conditional FK).
-- For installs that already ran an older 011 with required_hc, also run 012_staffing_plan_normalized.sql.

USE mis_ph_db;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS staffing_plan (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  scenario_id VARCHAR(96) NOT NULL,
  week_start DATE NOT NULL,
  -- Required Production FTE (UI label; never "Required HC")
  required_production_fte DECIMAL(14,4) NULL,
  production_fte DECIMAL(14,4) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staffing_plan_owner_scenario_week (owner_user_id, scenario_id, week_start),
  KEY idx_staffing_plan_owner (owner_user_id),
  KEY idx_staffing_plan_scenario (scenario_id),
  KEY idx_staffing_plan_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND CONSTRAINT_NAME = 'fk_staffing_plan_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @users_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
);

-- Error 1072 if a legacy staffing_plan exists without owner_user_id
-- (CREATE TABLE IF NOT EXISTS keeps the old shape). Check the column first.
SET @has_owner_user_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'owner_user_id'
);

-- One statement per PREPARE — never put ";" separators inside @sql.
SET @sql := IF(
  @fk_exists = 0 AND @users_exists > 0 AND @has_owner_user_id > 0,
  'ALTER TABLE staffing_plan ADD CONSTRAINT fk_staffing_plan_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT ''fk_staffing_plan_user skipped (already present, users missing, or no owner_user_id — run 013_staffing_plan_repair.sql)'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
