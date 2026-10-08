-- Data Quality Tool — MariaDB schema (SQLyog-compatible)
--
-- SQLyog: Tools → Execute SQL Script → select this file → Execute
-- Requires MariaDB 10.2.7+ (JSON/CHECK). Prefer 10.4+.

CREATE DATABASE IF NOT EXISTS mis_ph_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE mis_ph_db;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

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

-- ---------------------------------------------------------------------------
-- Repair a workflows table left behind by an older install.
--
-- CREATE TABLE IF NOT EXISTS keeps an existing table exactly as it is, so a
-- workflows built by an earlier version of this schema survives untouched --
-- and re-running this script never corrects it. Every table below points a
-- foreign key at workflows(id), and InnoDB requires the referencing column to
-- match the one it references: same type, same length, same collation, and the
-- parent must be InnoDB. A mismatch is error 1005, errno 150, "Foreign key
-- constraint is incorrectly formed", raised on the child table rather than on
-- workflows itself.
--
-- Both blocks below are skipped when workflows is already correct, which is the
-- case on a fresh install where the statement above just created it.
-- ---------------------------------------------------------------------------

-- A foreign key cannot reference a MyISAM table.
SET @wrong_engine := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflows'
    AND ENGINE <> 'InnoDB'
);

SET @sql := IF(
  @wrong_engine > 0,
  'ALTER TABLE workflows ENGINE=InnoDB',
  'SELECT ''workflows is already InnoDB'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- workflows.id must be CHAR(36) utf8mb4_unicode_ci, because that is what every
-- workflow_id column below is declared as. An older install may have VARCHAR(36),
-- or the same type under a different collation.
SET @wrong_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workflows'
    AND COLUMN_NAME = 'id'
    AND (LOWER(COLUMN_TYPE) <> 'char(36)' OR COLLATION_NAME <> 'utf8mb4_unicode_ci')
);

-- Bring the whole table to utf8mb4_unicode_ci first, then pin the id column.
-- The convert alone would not change VARCHAR(36) into CHAR(36).
SET @sql := IF(
  @wrong_id > 0,
  'ALTER TABLE workflows CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT ''workflows.id already matches the child tables'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @wrong_id > 0,
  'ALTER TABLE workflows MODIFY id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL',
  'SELECT ''workflows.id needs no change'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS workflow_rules (
  id CHAR(36) PRIMARY KEY,
  workflow_id CHAR(36) NOT NULL,
  rule_key VARCHAR(128) NOT NULL,
  rule_value JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_workflow_rule (workflow_id, rule_key),
  CONSTRAINT fk_workflow_rules_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS required_columns (
  id CHAR(36) PRIMARY KEY,
  workflow_id CHAR(36) NOT NULL,
  column_name VARCHAR(255) NOT NULL,
  data_type VARCHAR(32) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  allowed_values JSON NULL,
  pattern VARCHAR(512) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_required_column (workflow_id, column_name),
  CONSTRAINT fk_required_columns_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT chk_required_columns_type CHECK (data_type IN ('string', 'number', 'date', 'category'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
  id CHAR(36) PRIMARY KEY,
  workflow_id CHAR(36) NULL,
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
  id CHAR(36) PRIMARY KEY,
  file_id CHAR(36) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  can_proceed TINYINT(1) NOT NULL DEFAULT 0,
  summary JSON NOT NULL DEFAULT ('{}'),
  structure_result JSON NOT NULL DEFAULT ('{}'),
  data_quality_result JSON NOT NULL DEFAULT ('{}'),
  pivot_detection JSON NOT NULL DEFAULT ('{}'),
  KEY idx_validation_runs_file (file_id),
  CONSTRAINT fk_validation_runs_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_errors (
  id CHAR(36) PRIMARY KEY,
  validation_run_id CHAR(36) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  code VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  row_index INT NULL,
  column_name VARCHAR(255) NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_file_errors_run FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE,
  CONSTRAINT chk_file_errors_severity CHECK (severity IN ('error', 'warning', 'info'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checklist_items (
  id CHAR(36) PRIMARY KEY,
  workflow_id CHAR(36) NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  label VARCHAR(512) NOT NULL,
  is_critical TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_checklist_item (workflow_id, item_key),
  CONSTRAINT fk_checklist_items_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checklist_results (
  id CHAR(36) PRIMARY KEY,
  file_id CHAR(36) NOT NULL,
  validation_run_id CHAR(36) NOT NULL,
  item_key VARCHAR(128) NOT NULL,
  passed TINYINT(1) NOT NULL DEFAULT 0,
  acknowledged TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_checklist_result (file_id, validation_run_id, item_key),
  CONSTRAINT fk_checklist_results_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_checklist_results_run FOREIGN KEY (validation_run_id) REFERENCES validation_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  file_id CHAR(36) NULL,
  workflow_id CHAR(36) NULL,
  action VARCHAR(128) NOT NULL,
  details JSON NOT NULL DEFAULT ('{}'),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_created (created_at),
  CONSTRAINT fk_audit_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  file_id CHAR(36) NULL,
  workflow_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notifications_read (`read`, created_at),
  CONSTRAINT fk_notifications_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
