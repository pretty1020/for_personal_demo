-- Data Quality Tool — separate auth (does NOT touch Capacity users/sessions)
--
-- SQLyog: Tools → Execute SQL Script → this file → Execute
-- Run after 001_initial_schema.sql (same database mis_ph_db).
--
-- Seed admin (change password after first login):
--   email:    dq.admin@movate.com
--   password: DqAdmin!2026
--
-- Safe to re-run (IF NOT EXISTS / INSERT IGNORE for seed).

USE mis_ph_db;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS dq_users (
  id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dq_users_email (email),
  CONSTRAINT chk_dq_users_role CHECK (role IN ('admin', 'user'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dq_sessions (
  token CHAR(64) NOT NULL,
  user_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token),
  KEY idx_dq_sessions_user (user_id),
  KEY idx_dq_sessions_expires (expires_at),
  CONSTRAINT fk_dq_sessions_user
    FOREIGN KEY (user_id) REFERENCES dq_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed first DQ admin. INSERT IGNORE skips if email/id already exists.
-- Password hash is bcrypt for: DqAdmin!2026
INSERT IGNORE INTO dq_users (id, email, password_hash, name, role, is_active)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'dq.admin@movate.com',
  '$2a$12$x1On0kmDfw0vR8fKlEEXuujPG34MDdHtd6l4KriTTxfpxPmMWfJ4S',
  'DQ Admin',
  'admin',
  1
);

SELECT id, email, name, role, is_active FROM dq_users ORDER BY role, name;
