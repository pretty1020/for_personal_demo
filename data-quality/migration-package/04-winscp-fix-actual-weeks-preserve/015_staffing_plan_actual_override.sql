-- Persist actual-week override metrics on staffing_plan (survive refresh / upload).
-- Run AFTER 014_staffing_plan_planned_override.sql. Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'actual_override_json'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE staffing_plan
     ADD COLUMN actual_override_json JSON NULL
       COMMENT ''Imported/entered actual week metrics (volume, AHT, HC, …) — never invent fallbacks''
     AFTER planned_override_json',
  'SELECT ''actual_override_json already present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
