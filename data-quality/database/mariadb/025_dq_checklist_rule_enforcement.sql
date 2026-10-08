-- 025_dq_checklist_rule_enforcement.sql
-- Data Quality only — does NOT touch Capacity tables.
--
-- Documents and indexes support for workflow audit-rule enforcement:
--   • checklist_items rows = active rules for a workflow
--   • checklist_items.is_critical = 1 → may block validation / approve gate
--   • Removing a rule (DELETE from checklist_items) removes it from evaluation
--   • Non-critical rules are recorded but do not fail the engine pass
--
-- Safe to re-run. Does not delete existing checklist or validation data.

USE mis_ph_db;

SET NAMES utf8mb4;

-- Ensure checklist_items.is_critical is NOT NULL (enforcement flag)
SET @ci := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checklist_items'
);
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'checklist_items'
    AND COLUMN_NAME = 'is_critical'
);

SET @s1 := IF(
  @ci > 0 AND @col > 0,
  'ALTER TABLE checklist_items
     MODIFY COLUMN is_critical TINYINT(1) NOT NULL DEFAULT 1
     COMMENT ''1 = enforce in validation engine and approve gate; 0 = advisory only''',
  'SELECT ''checklist_items.is_critical skipped'' AS info'
);
PREPARE s1 FROM @s1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- Dashboard / analytics indexes on checklist_results
SET @cr := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checklist_results'
);
SET @idx1 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'checklist_results'
    AND INDEX_NAME = 'idx_cr_item_passed'
);
SET @s2 := IF(
  @cr > 0 AND @idx1 = 0,
  'ALTER TABLE checklist_results ADD INDEX idx_cr_item_passed (item_key, passed)',
  'SELECT ''idx_cr_item_passed ok'' AS info'
);
PREPARE s2 FROM @s2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @idx2 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'checklist_results'
    AND INDEX_NAME = 'idx_cr_file_item'
);
SET @s3 := IF(
  @cr > 0 AND @idx2 = 0,
  'ALTER TABLE checklist_results ADD INDEX idx_cr_file_item (file_id, item_key)',
  'SELECT ''idx_cr_file_item ok'' AS info'
);
PREPARE s3 FROM @s3; EXECUTE s3; DEALLOCATE PREPARE s3;

SET @idx3 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'checklist_items'
    AND INDEX_NAME = 'idx_ci_wf_critical'
);
SET @s4 := IF(
  @ci > 0 AND @idx3 = 0,
  'ALTER TABLE checklist_items ADD INDEX idx_ci_wf_critical (workflow_id, is_critical)',
  'SELECT ''idx_ci_wf_critical ok'' AS info'
);
PREPARE s4 FROM @s4; EXECUTE s4; DEALLOCATE PREPARE s4;

SELECT '025_dq_checklist_rule_enforcement complete — Capacity untouched' AS info;
