-- Capacity Plan — relational clients table (shared master list)
-- Moves clients out of the workspace_state JSON blob / browser localStorage.
-- Run in SQLyog AFTER 002 (and 004 + 005 if upgrading). Order: 001 → 002 → 004 → 005 → 006 → 003.
-- Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS capacity_clients (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  week_start VARCHAR(16) NOT NULL DEFAULT 'monday',
  capacity_plan_start_week VARCHAR(32) NOT NULL DEFAULT '',
  planning_weeks INT NOT NULL DEFAULT 52,
  build_method VARCHAR(16) NOT NULL DEFAULT 'forward',
  default_paid_hours DECIMAL(6,2) NOT NULL DEFAULT 40.00,
  default_shrinkage_pct DECIMAL(6,4) NOT NULL DEFAULT 0.2500,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_capacity_clients_name (name),
  KEY idx_capacity_clients_created_by (created_by),
  CONSTRAINT chk_capacity_clients_week_start CHECK (week_start IN ('sunday', 'monday')),
  CONSTRAINT chk_capacity_clients_build CHECK (build_method IN ('forward', 'import'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link to users only when the users table exists (it does after 002); skip silently otherwise.
SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'capacity_clients'
    AND CONSTRAINT_NAME = 'fk_capacity_clients_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @users_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
);

SET @sql := IF(
  @fk_exists = 0 AND @users_exists > 0,
  'ALTER TABLE capacity_clients
     ADD CONSTRAINT fk_capacity_clients_user
     FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''fk_capacity_clients_user already present or users table missing'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
