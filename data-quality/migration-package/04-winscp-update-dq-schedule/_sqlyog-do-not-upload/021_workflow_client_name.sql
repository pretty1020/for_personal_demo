-- Data Quality — add client_name on workflows (display on Dashboard)
-- SQLyog: Tools → Execute SQL Script → this file → Execute
-- Safe to re-run. Does NOT touch Capacity tables.
--
-- App also stores client_name inside pass_rules JSON, so the site still works
-- if this script is delayed — but run it so the dedicated column exists.

USE mis_ph_db;

SET NAMES utf8mb4;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflows'
    AND COLUMN_NAME = 'client_name'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE workflows ADD COLUMN client_name VARCHAR(255) NULL AFTER name',
  'SELECT ''client_name already present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
