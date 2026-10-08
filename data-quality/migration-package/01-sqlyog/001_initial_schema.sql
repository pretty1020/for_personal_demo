-- Data Quality Tool — MariaDB schema (SQLyog-compatible)
--
-- SQLyog: Tools → Execute SQL Script → select this file → Execute
-- Requires MariaDB 10.2.7+ (JSON/CHECK). Prefer 10.4+.
--
-- Fresh install: run this file once.
-- If you see errno 150 (FK incorrectly formed) or Error 1833 on ALTER CONVERT,
-- do NOT keep re-running this file alone — run 001b_rebuild_dq_core_tables.sql
-- instead (drops and recreates DQ core tables with matching collations).

CREATE DATABASE IF NOT EXISTS mis_ph_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mis_ph_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Greenfield only. If an incompatible workflows table already exists,
-- CREATE TABLE IF NOT EXISTS will NOT fix it — use 001b.
CREATE TABLE IF NOT EXISTS workflows (
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

CREATE TABLE IF NOT EXISTS workflow_rules (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  rule_key VARCHAR(128) NOT NULL,
  rule_value JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workflow_rule (workflow_id, rule_key),
  CONSTRAINT fk_workflow_rules_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS required_columns (
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
  CONSTRAINT fk_required_columns_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT chk_required_columns_type CHECK (data_type IN ('string', 'number', 'date', 'category'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
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
  CONSTRAINT fk_files_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL,
  CONSTRAINT chk_files_intake CHECK (intake_source IN ('upload', 'watched_folder', 'simulated_path')),
  CONSTRAINT chk_files_status CHECK (status IN (
    'pending', 'validating', 'blocked', 'pending_review', 'approved', 'rejected', 'processed', 'duplicate_blocked'
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS validation_runs (
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
  CONSTRAINT fk_validation_runs_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_errors (
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
  CONSTRAINT fk_file_errors_run FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE,
  CONSTRAINT chk_file_errors_severity CHECK (severity IN ('error', 'warning', 'info'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checklist_items (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  label VARCHAR(512) NOT NULL,
  is_critical TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_item (workflow_id, item_key),
  CONSTRAINT fk_checklist_items_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checklist_results (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  validation_run_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  acknowledged TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checklist_result (file_id, validation_run_id, item_key),
  CONSTRAINT fk_checklist_results_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_checklist_results_run FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  workflow_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  action VARCHAR(128) NOT NULL,
  details JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
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
  CONSTRAINT fk_notifications_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
