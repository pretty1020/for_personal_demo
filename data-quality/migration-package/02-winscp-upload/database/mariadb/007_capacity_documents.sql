-- Capacity Plan — per-user planning documents (scenarios, overrides, DBE lines, scheduling).
-- Moves planning data out of the single workspace_state JSON blob so each document is
-- stored, owned and versioned on its own row.
--
-- Visibility is enforced in the application layer:
--   cap_planner / analyst      -> only rows they own
--   manager / director / vp / admin -> every row, including combined Summary totals
--
-- Run in SQLyog AFTER 002. Order: 001 -> 002 -> 004 -> 005 -> 006 -> 007 -> 003.
-- Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS capacity_documents (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  doc_key VARCHAR(96) NOT NULL,
  payload LONGTEXT NOT NULL,
  -- Bumped on every write so a stale tab cannot silently clobber a newer save.
  revision BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_capacity_documents_owner_key (owner_user_id, doc_key),
  KEY idx_capacity_documents_key (doc_key),
  KEY idx_capacity_documents_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link to users only when the users table exists (it does after 002); skip silently otherwise.
-- Documents are removed with their owner: a deleted account leaves no unreachable rows.
SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'capacity_documents'
    AND CONSTRAINT_NAME = 'fk_capacity_documents_user'
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
  'ALTER TABLE capacity_documents
     ADD CONSTRAINT fk_capacity_documents_user
     FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE',
  'SELECT ''fk_capacity_documents_user already present or users table missing'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
