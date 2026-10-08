-- =============================================================================
-- MANUAL FIX (copy/paste if 013 dynamic script still fails)
-- Run each block separately in SQLyog if needed.
-- =============================================================================

USE mis_ph_db;

-- A) Free the name "staffing_plan" (keeps old wrong table as backup)
DROP TABLE IF EXISTS staffing_plan_shrinkage;
RENAME TABLE staffing_plan TO staffing_plan_legacy_unused;

-- If RENAME fails because backup already exists, use this instead:
-- DROP TABLE staffing_plan;

-- B) Correct Capacity table
CREATE TABLE staffing_plan (
  id CHAR(36) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  scenario_id VARCHAR(96) NOT NULL,
  week_start DATE NOT NULL,
  required_production_fte DECIMAL(14,4) NULL,
  production_fte DECIMAL(14,4) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staffing_plan_owner_scenario_week (owner_user_id, scenario_id, week_start),
  KEY idx_staffing_plan_owner (owner_user_id),
  KEY idx_staffing_plan_scenario (scenario_id),
  KEY idx_staffing_plan_week (week_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE staffing_plan_shrinkage (
  id CHAR(36) PRIMARY KEY,
  staffing_plan_id CHAR(36) NOT NULL,
  category_id VARCHAR(96) NOT NULL,
  category_name VARCHAR(191) NOT NULL DEFAULT '',
  category_group VARCHAR(32) NOT NULL DEFAULT 'in_office',
  planned_pct DECIMAL(10,6) NULL,
  actual_pct DECIMAL(10,6) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_staffing_plan_shrinkage_week_cat (staffing_plan_id, category_id),
  KEY idx_staffing_plan_shrinkage_plan (staffing_plan_id),
  KEY idx_staffing_plan_shrinkage_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE staffing_plan
  ADD CONSTRAINT fk_staffing_plan_user
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE staffing_plan_shrinkage
  ADD CONSTRAINT fk_staffing_plan_shrinkage_plan
  FOREIGN KEY (staffing_plan_id) REFERENCES staffing_plan(id) ON DELETE CASCADE;

SHOW COLUMNS FROM staffing_plan;
