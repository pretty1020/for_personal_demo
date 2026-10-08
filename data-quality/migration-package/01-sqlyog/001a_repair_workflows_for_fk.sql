-- Fix errno 150 when 001_initial_schema.sql cannot create workflow_rules / files.
-- Cause: an older `workflows` table does not match CHAR(36) utf8mb4_unicode_ci InnoDB + PRIMARY KEY.
--
-- SQLyog:
--   1) Run this script first (Tools → Execute SQL Script).
--   2) Then re-run 001_initial_schema.sql.
--
-- Safe for Capacity: Capacity uses users / staffing_plan / capacity_* — not this workflows table.
-- If you already have DQ workflow rows you care about, run the DIAGNOSE block first and stop if unsure.

USE mis_ph_db;

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- Recreate workflows if it was dropped (e.g. last-resort DROP before re-running 001).
CREATE TABLE IF NOT EXISTS workflows (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL,
  source_path TEXT NULL,
  expected_file_type VARCHAR(8) NOT NULL,
  destination_label VARCHAR(255) NOT NULL DEFAULT 'Processed',
  pass_rules JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_workflows_status CHECK (status IN ('active', 'disabled')),
  CONSTRAINT chk_workflows_source CHECK (source_type IN ('upload', 'watched_folder', 'simulated_path')),
  CONSTRAINT chk_workflows_file_type CHECK (expected_file_type IN ('csv', 'xlsx'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== DIAGNOSE (optional — run and read results) ==========
SELECT ENGINE, TABLE_COLLATION
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'mis_ph_db' AND TABLE_NAME = 'workflows';

SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, IS_NULLABLE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'mis_ph_db' AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'id';

SELECT COUNT(*) AS workflow_row_count FROM workflows;

-- ========== FORCE REPAIR ==========
-- Drop any half-created child tables from failed 001 runs (they hold no app data yet if CREATE failed).
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS checklist_results;
DROP TABLE IF EXISTS validation_runs;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS required_columns;
DROP TABLE IF EXISTS workflow_rules;

-- Ensure InnoDB + unicode collation on the whole table.
ALTER TABLE workflows ENGINE=InnoDB;
ALTER TABLE workflows CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Pin id to exactly what child FKs declare.
ALTER TABLE workflows
  MODIFY id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

-- Ensure PRIMARY KEY on id (required for InnoDB foreign keys).
SET @has_pk := (
  SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = 'mis_ph_db'
     AND TABLE_NAME = 'workflows'
     AND CONSTRAINT_TYPE = 'PRIMARY KEY'
);

SET @sql := IF(
  @has_pk = 0,
  'ALTER TABLE workflows ADD PRIMARY KEY (id)',
  'SELECT ''workflows already has PRIMARY KEY'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;

-- Confirm — id must be char(36) / utf8mb4_unicode_ci / PRI / InnoDB
SELECT ENGINE, TABLE_COLLATION
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'mis_ph_db' AND TABLE_NAME = 'workflows';

SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'mis_ph_db' AND TABLE_NAME = 'workflows' AND COLUMN_NAME = 'id';

SELECT 'Repair done. Now re-run 001_initial_schema.sql' AS next_step;
