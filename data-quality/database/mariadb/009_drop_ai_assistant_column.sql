-- Drops users.ai_assistant_approved.
--
-- The app has no AI assistant. The column was a leftover flag that was only ever written
-- as 0, read by nothing, and shown nowhere. This removes it so the users table matches
-- what the application actually does.
--
-- Run in SQLyog AFTER the new application code is uploaded and built. The order matters:
-- the previous build named this column in its INSERT for new users, so dropping it first
-- would break user creation until the new code is live. Nothing else references it.
--
-- Order: 001 -> 002 -> 004 -> 005 -> 006 -> 007 -> 008 -> 009 -> 003.
-- Safe to re-run: does nothing when the column is already gone.

USE mis_ph_db;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'ai_assistant_approved'
);

SET @sql := IF(
  @col_exists > 0,
  'ALTER TABLE users DROP COLUMN ai_assistant_approved',
  'SELECT ''users.ai_assistant_approved already removed'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
