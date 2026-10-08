-- Capacity Plan — activity trail and admin-managed shared settings.
--
-- Two tables, both new:
--
--   capacity_audit_log      Who did what, and to whose data. Written by the server on
--                           every plan save/delete, account change and sign-in attempt.
--                           Admins read it; nobody can write to it from the browser.
--
--   capacity_shared_settings  Settings that belong to the organisation rather than to a
--                           person — currently the formula definitions. Admins write,
--                           everyone reads, so one edit reaches every planner.
--
-- Deliberately separate from the Data Quality Tool's audit_logs table: that one has no
-- actor column and its foreign keys point at files/workflows, so a Capacity event could
-- only be stored as an untraceable JSON blob with two NULLs.
--
-- Run in SQLyog AFTER 007. Order: 001 -> 002 -> 004 -> 005 -> 006 -> 007 -> 008 -> 003.
-- Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Activity trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capacity_audit_log (
  id CHAR(36) PRIMARY KEY,

  -- Who performed the action. Kept even if the account is later deleted, which is why
  -- this is ON DELETE SET NULL rather than CASCADE: removing a user must not erase the
  -- history of what they did. The denormalised copies below preserve the name/email.
  actor_user_id CHAR(36) NULL,
  actor_email VARCHAR(255) NOT NULL DEFAULT '',
  actor_name VARCHAR(255) NOT NULL DEFAULT '',
  actor_access_level VARCHAR(32) NOT NULL DEFAULT '',

  -- Whose data was affected. Differs from the actor when a manager edits on behalf of a
  -- planner, which is the case this column exists to make visible.
  target_user_id CHAR(36) NULL,
  target_email VARCHAR(255) NOT NULL DEFAULT '',

  action VARCHAR(64) NOT NULL,
  -- The document key, client id, or account touched. Free-form on purpose.
  subject VARCHAR(160) NOT NULL DEFAULT '',
  details JSON NULL,

  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  KEY idx_capacity_audit_created (created_at),
  KEY idx_capacity_audit_actor (actor_user_id, created_at),
  KEY idx_capacity_audit_target (target_user_id, created_at),
  KEY idx_capacity_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Shared, admin-managed settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS capacity_shared_settings (
  setting_key VARCHAR(96) PRIMARY KEY,
  payload LONGTEXT NOT NULL,
  -- Bumped on every write so a stale admin tab cannot overwrite a newer edit.
  revision BIGINT NOT NULL DEFAULT 1,
  updated_by CHAR(36) NULL,
  updated_by_email VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Foreign keys, added only when the users table exists (it does after 002).
-- All are SET NULL: history and settings outlive the accounts that produced them.
-- ---------------------------------------------------------------------------

SET @users_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
);

SET @fk_actor := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'capacity_audit_log'
    AND CONSTRAINT_NAME = 'fk_capacity_audit_actor'
);

SET @sql := IF(
  @fk_actor = 0 AND @users_exists > 0,
  'ALTER TABLE capacity_audit_log
     ADD CONSTRAINT fk_capacity_audit_actor
     FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''fk_capacity_audit_actor already present or users table missing'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_target := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'capacity_audit_log'
    AND CONSTRAINT_NAME = 'fk_capacity_audit_target'
);

SET @sql := IF(
  @fk_target = 0 AND @users_exists > 0,
  'ALTER TABLE capacity_audit_log
     ADD CONSTRAINT fk_capacity_audit_target
     FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''fk_capacity_audit_target already present or users table missing'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_settings := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'capacity_shared_settings'
    AND CONSTRAINT_NAME = 'fk_capacity_shared_settings_user'
);

SET @sql := IF(
  @fk_settings = 0 AND @users_exists > 0,
  'ALTER TABLE capacity_shared_settings
     ADD CONSTRAINT fk_capacity_shared_settings_user
     FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''fk_capacity_shared_settings_user already present or users table missing'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
