-- =============================================================================
-- 001b — Rebuild Data Quality core tables (fix errno 150 / 1833)
-- =============================================================================
--
-- USE THIS when 001_initial_schema.sql fails with:
--   Error 1005 (errno 150) Foreign key constraint is incorrectly formed
--   Error 1833 Cannot change column used in a foreign key constraint
--
-- Root cause: an old `workflows.id` (wrong type/length/charset/collation/engine
-- or missing PRIMARY KEY) cannot be the parent of workflow_id FKs. Leftover
-- half-created child tables then block ALTER CONVERT (error 1833).
--
-- DATA LOSS WARNING
-- -----------------
-- This script DROPS and recreates the Data Quality tables listed below.
-- All rows in those tables are deleted. Capacity tables (users, staffing_plan,
-- capacity_*, sessions, workspace_state) are NOT touched.
--
-- BEFORE RUNNING — backup:
--   mysqldump -u USER -p mis_ph_db workflows workflow_rules required_columns \
--     files validation_runs file_errors checklist_items checklist_results \
--     audit_logs notifications > dq_core_backup.sql
-- Or in SQLyog: right-click mis_ph_db → Backup Database As SQL Dump…
--
-- SQLyog: Tools → Execute SQL Script → this file → Execute
-- Then hard-refresh Dashboard / Upload / Workflows.
-- MariaDB 10.2.7+ (JSON + CHECK). Prefer 10.4+.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS mis_ph_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mis_ph_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 0) Inspect (read-only — keep results for support if anything still fails)
-- ---------------------------------------------------------------------------
-- SHOW CREATE TABLE workflows;
-- SHOW CREATE TABLE files;
-- SHOW CREATE TABLE workflow_rules;
-- SHOW CREATE TABLE required_columns;
-- SHOW TABLE STATUS WHERE Name IN ('workflows','files','workflow_rules','required_columns');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME IN ('workflows','files','workflow_rules','required_columns','checklist_items','audit_logs','notifications')
   AND COLUMN_NAME IN ('id','workflow_id')
 ORDER BY TABLE_NAME, COLUMN_NAME;

-- ---------------------------------------------------------------------------
-- 1) Drop children in reverse dependency order, then parent
--    (Do NOT use CREATE TABLE IF NOT EXISTS for workflows — incompatible
--     leftovers must be removed explicitly.)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS checklist_results;
DROP TABLE IF EXISTS checklist_items;
DROP TABLE IF EXISTS file_errors;
DROP TABLE IF EXISTS validation_runs;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS required_columns;
DROP TABLE IF EXISTS workflow_rules;
DROP TABLE IF EXISTS workflows;

-- ---------------------------------------------------------------------------
-- 2) Recreate workflows FIRST — id must be exactly CHAR(36) utf8mb4_unicode_ci + PK
-- ---------------------------------------------------------------------------
CREATE TABLE workflows (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(255) NOT NULL,
  client_name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL,
  source_path TEXT NULL,
  expected_file_type VARCHAR(8) NOT NULL,
  destination_label VARCHAR(255) NOT NULL DEFAULT 'Processed',
  pass_rules JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_workflows_status CHECK (status IN ('active', 'disabled')),
  CONSTRAINT chk_workflows_source CHECK (source_type IN ('upload', 'watched_folder', 'simulated_path')),
  CONSTRAINT chk_workflows_file_type CHECK (expected_file_type IN ('csv', 'xlsx'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3) Recreate children AFTER — every workflow_id matches workflows.id exactly
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_rules (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  rule_key VARCHAR(128) NOT NULL,
  rule_value JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_rule (workflow_id, rule_key),
  CONSTRAINT fk_workflow_rules_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE required_columns (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  column_name VARCHAR(255) NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  allowed_values JSON NULL,
  pattern VARCHAR(512) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_required_column (workflow_id, column_name),
  CONSTRAINT fk_required_columns_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT chk_required_columns_type
    CHECK (data_type IN ('string', 'number', 'date', 'category'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE files (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  original_name VARCHAR(512) NOT NULL,
  storage_path TEXT NOT NULL,
  file_hash CHAR(64) NOT NULL,
  mime_type VARCHAR(128) NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  intake_source VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  metadata JSON NOT NULL DEFAULT ('{}'),
  processed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY idx_files_workflow_hash (workflow_id, file_hash),
  KEY idx_files_workflow_status (workflow_id, status),
  KEY idx_files_created (created_at),
  CONSTRAINT fk_files_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL,
  CONSTRAINT chk_files_intake
    CHECK (intake_source IN ('upload', 'watched_folder', 'simulated_path')),
  CONSTRAINT chk_files_status CHECK (status IN (
    'pending', 'validating', 'blocked', 'pending_review', 'approved', 'rejected', 'processed', 'duplicate_blocked'
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE validation_runs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  can_proceed TINYINT(1) NOT NULL DEFAULT 0,
  summary JSON NOT NULL DEFAULT ('{}'),
  structure_result JSON NOT NULL DEFAULT ('{}'),
  data_quality_result JSON NOT NULL DEFAULT ('{}'),
  pivot_detection JSON NOT NULL DEFAULT ('{}'),
  PRIMARY KEY (id),
  KEY idx_validation_runs_file (file_id),
  CONSTRAINT fk_validation_runs_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE file_errors (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  validation_run_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  severity VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  row_index INT NULL,
  column_name VARCHAR(255) NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_file_errors_run
    FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE,
  CONSTRAINT chk_file_errors_severity CHECK (severity IN ('error', 'warning', 'info'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_items (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  label VARCHAR(512) NOT NULL,
  is_critical TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_item (workflow_id, item_key),
  CONSTRAINT fk_checklist_items_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE checklist_results (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  validation_run_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  acknowledged TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_result (file_id, validation_run_id, item_key),
  CONSTRAINT fk_checklist_results_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_checklist_results_run
    FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  action VARCHAR(128) NOT NULL,
  details JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_read (`read`, created_at),
  CONSTRAINT fk_notifications_file
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_workflow
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- 4) Verification — every id / workflow_id must be CHAR(36) utf8mb4_unicode_ci
-- ---------------------------------------------------------------------------
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME IN ('id', 'workflow_id')
   AND TABLE_NAME IN (
     'workflows', 'workflow_rules', 'required_columns', 'files',
     'validation_runs', 'file_errors', 'checklist_items', 'checklist_results',
     'audit_logs', 'notifications'
   )
 ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'FAIL: expected columns missing'
    WHEN SUM(
      CASE
        WHEN LOWER(COLUMN_TYPE) = 'char(36)'
         AND CHARACTER_SET_NAME = 'utf8mb4'
         AND COLLATION_NAME = 'utf8mb4_unicode_ci'
        THEN 0 ELSE 1
      END
    ) = 0
    THEN 'OK: all id/workflow_id columns are CHAR(36) utf8mb4_unicode_ci'
    ELSE 'FAIL: one or more id/workflow_id columns still mismatch'
  END AS verification
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME IN ('id', 'workflow_id')
  AND TABLE_NAME IN (
    'workflows', 'workflow_rules', 'required_columns', 'files',
    'checklist_items', 'audit_logs', 'notifications'
  );

SHOW TABLE STATUS WHERE Name IN ('workflows','files','workflow_rules','required_columns');

SELECT '001b complete. Hard-refresh Dashboard. Capacity tables were not modified.' AS next_step;
