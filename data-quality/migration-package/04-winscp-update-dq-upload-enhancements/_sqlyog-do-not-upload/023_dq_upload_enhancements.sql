-- 023_dq_upload_enhancements.sql
-- Data Quality upload enhancements (no Capacity changes).
-- SharePoint URL + require_yyyymmdd live in workflows.pass_rules JSON.
-- File visibility + period_yyyymmdd live in files.metadata JSON.
-- Safe to re-run. Soft-defaults only; skips when tables/columns are missing
-- or when a row has invalid JSON (avoids aborting the whole script).

USE mis_ph_db;

SET NAMES utf8mb4;

-- Guard: tables
SET @wf_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows'
);
SET @files_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files'
);

SET @g1 := IF(
  @wf_exists = 0,
  'SELECT ''ERROR: workflows table missing - run DQ core schema (001/018) first'' AS error',
  'SELECT ''workflows present'' AS info'
);
PREPARE g1 FROM @g1; EXECUTE g1; DEALLOCATE PREPARE g1;

SET @g2 := IF(
  @files_exists = 0,
  'SELECT ''ERROR: files table missing - run DQ core schema (001/018) first'' AS error',
  'SELECT ''files present'' AS info'
);
PREPARE g2 FROM @g2; EXECUTE g2; DEALLOCATE PREPARE g2;

-- Soft-default require_yyyymmdd on workflows.pass_rules
SET @pr_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'pass_rules'
);
SET @u1 := IF(
  @wf_exists > 0 AND @pr_col > 0,
  'UPDATE workflows
     SET pass_rules = JSON_SET(IF(pass_rules IS NULL OR pass_rules = '''', ''{}'', pass_rules), ''$.require_yyyymmdd'', true)
     WHERE (pass_rules IS NULL OR pass_rules = '''' OR JSON_VALID(pass_rules))
       AND JSON_EXTRACT(IF(pass_rules IS NULL OR pass_rules = '''', ''{}'', pass_rules), ''$.require_yyyymmdd'') IS NULL',
  'SELECT ''skipped workflows.require_yyyymmdd soft-default'' AS info'
);
PREPARE u1 FROM @u1; EXECUTE u1; DEALLOCATE PREPARE u1;

-- Soft-default visibility on files.metadata
SET @meta_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'files' AND COLUMN_NAME = 'metadata'
);
SET @u2 := IF(
  @files_exists > 0 AND @meta_col > 0,
  'UPDATE files
     SET metadata = JSON_SET(IF(metadata IS NULL OR metadata = '''', ''{}'', metadata), ''$.visibility'', ''public'')
     WHERE (metadata IS NULL OR metadata = '''' OR JSON_VALID(metadata))
       AND JSON_EXTRACT(IF(metadata IS NULL OR metadata = '''', ''{}'', metadata), ''$.visibility'') IS NULL',
  'SELECT ''skipped files.visibility soft-default'' AS info'
);
PREPARE u2 FROM @u2; EXECUTE u2; DEALLOCATE PREPARE u2;

SELECT '023_dq_upload_enhancements complete' AS info;
