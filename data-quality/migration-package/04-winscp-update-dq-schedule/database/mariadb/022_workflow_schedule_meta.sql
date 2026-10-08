-- Data Quality — optional schedule metadata columns on workflows
-- SQLyog: Tools → Execute SQL Script → this file → Execute
-- Safe to re-run. Does NOT touch Capacity.
--
-- Prerequisite: workflows table exists (001 / 018 / prior DQ packages).
-- App stores frequency / owners / allow_duplicates in pass_rules JSON;
-- these columns are optional mirrors for SQL reporting.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Fail clearly if workflows is missing (avoids cryptic ALTER errors)
SET @wf_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows'
);
SET @guard := IF(
  @wf_exists = 0,
  'SELECT ''ERROR: workflows table missing — run DQ core schema (001/018) first'' AS error',
  'SELECT ''workflows present'' AS info'
);
PREPARE gstmt FROM @guard; EXECUTE gstmt; DEALLOCATE PREPARE gstmt;

-- upload_frequency (no AFTER clause — safer across schema variants)
SET @c1 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'upload_frequency'
);
SET @s1 := IF(
  @c1 = 0 AND @wf_exists > 0,
  'ALTER TABLE workflows ADD COLUMN upload_frequency VARCHAR(16) NULL',
  IF(@c1 > 0, 'SELECT ''upload_frequency already present'' AS info', 'SELECT ''skipped upload_frequency'' AS info')
);
PREPARE stmt1 FROM @s1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- allow_duplicates
SET @c2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'allow_duplicates'
);
SET @s2 := IF(
  @c2 = 0 AND @wf_exists > 0,
  'ALTER TABLE workflows ADD COLUMN allow_duplicates TINYINT(1) NOT NULL DEFAULT 0',
  IF(@c2 > 0, 'SELECT ''allow_duplicates already present'' AS info', 'SELECT ''skipped allow_duplicates'' AS info')
);
PREPARE stmt2 FROM @s2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- data_owners (JSON array). LONGTEXT-compatible on older MariaDB via JSON type alias.
SET @c3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'data_owners'
);
SET @s3 := IF(
  @c3 = 0 AND @wf_exists > 0,
  'ALTER TABLE workflows ADD COLUMN data_owners JSON NULL',
  IF(@c3 > 0, 'SELECT ''data_owners already present'' AS info', 'SELECT ''skipped data_owners'' AS info')
);
PREPARE stmt3 FROM @s3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
