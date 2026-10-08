-- Paste into a NEW SQLyog query window and run ONE block at a time.
-- Stop and send me the result if any step fails.
-- Capacity / dq_users are not touched.

USE mis_ph_db;
SET FOREIGN_KEY_CHECKS = 0;

-- STEP A: What still exists?
SHOW TABLES;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = 'mis_ph_db'
   AND REFERENCED_TABLE_NAME IN ('workflows','files');

-- STEP B: Drop DQ core tables (run all)
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

-- STEP C: Create as MyISAM (must succeed — if this fails, paste the error)
CREATE TABLE workflows (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source_type VARCHAR(32) NOT NULL,
  source_path TEXT NULL,
  expected_file_type VARCHAR(8) NOT NULL,
  destination_label VARCHAR(255) NOT NULL DEFAULT 'Processed',
  pass_rules LONGTEXT NOT NULL DEFAULT '{}',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP D: Convert to InnoDB
ALTER TABLE workflows ENGINE=InnoDB;

-- STEP E: Minimal files table (no FK)
CREATE TABLE files (
  id CHAR(36) NOT NULL PRIMARY KEY,
  workflow_id CHAR(36) NULL,
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
  KEY idx_files_workflow (workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

SHOW TABLES LIKE 'workflows';
SHOW TABLES LIKE 'files';
SHOW TABLE STATUS WHERE Name IN ('workflows','files');
