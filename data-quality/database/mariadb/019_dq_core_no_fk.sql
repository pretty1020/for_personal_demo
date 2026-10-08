-- =============================================================================
-- 019 — Nuclear fix: recreate DQ core tables WITHOUT foreign keys
-- =============================================================================
--
-- Use when even CREATE TABLE workflows fails with errno 150.
-- Cause: leftover InnoDB FK metadata / orphan child tables.
--
-- This script:
--   1) Lists anything still referencing workflows (for your eyes)
--   2) Drops ALL Data Quality core tables
--   3) Recreates them with matching CHAR(36) utf8mb4 columns
--   4) Does NOT add FOREIGN KEY constraints (Dashboard does not need them)
--
-- Capacity SAFE — does not touch:
--   users, sessions, staffing_plan*, capacity_*, dq_users, dq_sessions, workspace_state
--
-- SQLyog steps:
--   1. Open a NEW query window (File → New Query Editor)
--   2. Paste this ENTIRE file (or Tools → Execute SQL Script → this file)
--   3. Execute
--   4. Confirm the final SELECT says OK
--   5. Hard-refresh Dashboard (Ctrl+F5)
--
-- Ignore the old error HISTORY list (Sep 6–19). Only care about THIS run.
-- =============================================================================

USE mis_ph_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- See what still points at workflows (informational)
-- ---------------------------------------------------------------------------
SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = 'mis_ph_db'
   AND REFERENCED_TABLE_NAME = 'workflows';

-- ---------------------------------------------------------------------------
-- Drop every DQ core table (children first, then parent). Repeat names OK.
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

-- If an orphan tablespace blocks recreate, try again after rename scrap
DROP TABLE IF EXISTS workflows_new;
DROP TABLE IF EXISTS workflows_old;

-- ---------------------------------------------------------------------------
-- Create parent (NO foreign keys, NO check constraints)
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
  pass_rules LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Create children (NO foreign keys)
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_rules (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  rule_key VARCHAR(128) NOT NULL,
  rule_value LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_rule (workflow_id, rule_key),
  KEY idx_workflow_rules_workflow (workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE required_columns (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  column_name VARCHAR(255) NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  allowed_values LONGTEXT NULL,
  pattern VARCHAR(512) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_required_column (workflow_id, column_name),
  KEY idx_required_columns_workflow (workflow_id)
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
  metadata LONGTEXT NOT NULL DEFAULT '{}',
  processed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY idx_files_workflow_hash (workflow_id, file_hash),
  KEY idx_files_workflow_status (workflow_id, status),
  KEY idx_files_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE validation_runs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  can_proceed TINYINT(1) NOT NULL DEFAULT 0,
  summary LONGTEXT NOT NULL DEFAULT '{}',
  structure_result LONGTEXT NOT NULL DEFAULT '{}',
  data_quality_result LONGTEXT NOT NULL DEFAULT '{}',
  pivot_detection LONGTEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (id),
  KEY idx_validation_runs_file (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE file_errors (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  validation_run_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  severity VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  row_index INT NULL,
  column_name VARCHAR(255) NULL,
  details LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_file_errors_run (validation_run_id)
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
  KEY idx_checklist_items_workflow (workflow_id)
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
  KEY idx_checklist_results_file (file_id),
  KEY idx_checklist_results_run (validation_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  action VARCHAR(128) NOT NULL,
  details LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_file (file_id),
  KEY idx_audit_workflow (workflow_id)
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
  KEY idx_notifications_file (file_id),
  KEY idx_notifications_workflow (workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET UNIQUE_CHECKS = 1;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
SHOW TABLES LIKE 'workflows';
SHOW TABLES LIKE 'files';

SELECT TABLE_NAME
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'mis_ph_db'
   AND TABLE_NAME IN (
     'workflows','workflow_rules','required_columns','files',
     'validation_runs','file_errors','checklist_items','checklist_results',
     'audit_logs','notifications'
   )
 ORDER BY TABLE_NAME;

SELECT 'OK — Ctrl+F5 Dashboard. Capacity / dq_users unchanged. No FKs (intentional).' AS next_step;
