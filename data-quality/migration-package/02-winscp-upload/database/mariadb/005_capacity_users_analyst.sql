-- Capacity Plan — allow Analyst access_level on users
-- Run in SQLyog AFTER 002 (and 004 if upgrading) and BEFORE 003 (demo users).
-- Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Drop existing access-level check if present, then recreate with analyst.
SET @chk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'chk_users_access'
    AND CONSTRAINT_TYPE = 'CHECK'
);

SET @sql := IF(
  @chk_exists > 0,
  'ALTER TABLE users DROP CONSTRAINT chk_users_access',
  'SELECT ''chk_users_access not present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Re-add only when missing (covers first run after drop and no-op re-runs).
SET @chk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND CONSTRAINT_NAME = 'chk_users_access'
    AND CONSTRAINT_TYPE = 'CHECK'
);

SET @sql := IF(
  @chk_exists = 0,
  'ALTER TABLE users ADD CONSTRAINT chk_users_access CHECK (access_level IN (
    ''executive'', ''manager'', ''admin'', ''director'', ''cap_planner'', ''vp'', ''analyst''
  ))',
  'SELECT ''chk_users_access already present'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
