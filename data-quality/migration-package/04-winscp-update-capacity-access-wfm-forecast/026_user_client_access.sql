-- Manager client grants — Admin assigns which clients a Manager may view/edit.
-- Run in SQLyog after prior Capacity scripts.
-- Tools → Execute SQL Script → this file → Execute

USE mis_ph_db;

-- JSON array of client names, e.g. ["Acme","Contoso"]. NULL / [] = no clients for Managers (no fallback to all).
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'allowed_clients'
);

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN allowed_clients JSON NULL AFTER access_level',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
