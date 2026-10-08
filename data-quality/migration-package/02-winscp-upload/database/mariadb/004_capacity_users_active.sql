-- Capacity Plan — add is_active for user management (existing DBs)
-- Run in SQLyog AFTER 002 and BEFORE 003 (demo users).
-- Safe to re-run; no-op when users.is_active already exists (including fresh 002).

USE mis_ph_db;

SET NAMES utf8mb4;

-- MariaDB: add column only when missing
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'is_active'
);

-- No AFTER clause: the column order differs between old and new installs.
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT ''users.is_active already present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users SET is_active = 1 WHERE is_active IS NULL;
