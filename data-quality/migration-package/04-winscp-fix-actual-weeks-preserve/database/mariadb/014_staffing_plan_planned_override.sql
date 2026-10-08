-- Persist full planned-week template metrics on staffing_plan (not only FTE).
-- Volume, AHT, occupancy, HC drivers, etc. survive refresh via planned_override_json.
--
-- Run in SQLyog AFTER 011/012/013. Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'staffing_plan'
    AND COLUMN_NAME = 'planned_override_json'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE staffing_plan
     ADD COLUMN planned_override_json JSON NULL
       COMMENT ''Full planned week override metrics from template upload (volume, AHT, occupancy, HC, …)''
     AFTER production_fte',
  'SELECT ''planned_override_json already present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
