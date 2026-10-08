-- =============================================================================
-- 018 — FORCE fix Data Quality core tables (errno 150 / missing workflows)
-- =============================================================================
--
-- WHY CREATE workflows FAILS WITH errno 150 EVEN WITH NO FK ON workflows:
--   Leftover child tables (required_columns, files, workflow_rules, …) still
--   have FOREIGN KEYs pointing at workflows. InnoDB refuses to create a new
--   workflows parent until those children are dropped.
--
-- This script:
--   1) Turns off FK checks
--   2) DROPS all DQ child tables, then workflows
--   3) Recreates workflows first, then children with matching CHAR(36) utf8mb4
--
-- DATA LOSS: empties DQ upload/workflow history only.
-- Capacity SAFE: does NOT touch users, sessions, staffing_plan, capacity_*, dq_users.
--
-- SQLyog: Tools → Execute SQL Script → select THIS file → Execute
-- Ignore the old error history in SQLyog (dates from Sep 6–19). Run this once.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS mis_ph_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mis_ph_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Drop children FIRST (order matters), then parent
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
-- Parent first
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
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Children (workflow_id must match workflows.id exactly)
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
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
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
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
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
    FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE
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
-- Verify — both must return a row
-- ---------------------------------------------------------------------------
SHOW TABLES LIKE 'workflows';
SHOW TABLES LIKE 'files';

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'mis_ph_db'
   AND TABLE_NAME IN ('workflows', 'files', 'workflow_rules', 'required_columns')
 ORDER BY TABLE_NAME;

SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'mis_ph_db'
   AND TABLE_NAME = 'workflows'
   AND COLUMN_NAME = 'id';

SELECT 'OK — hard-refresh Dashboard (Ctrl+F5). Capacity and DQ login users were not changed.' AS next_step;
