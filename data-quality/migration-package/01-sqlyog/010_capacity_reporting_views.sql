-- Capacity Plan — read-only reporting views.
--
-- Purpose: let you confirm in SQL that Capacity data really is in MariaDB, and read it
-- as normalised rows instead of opening a JSON payload by hand.
--
-- These are VIEWS, not copies. They read capacity_clients and capacity_documents live,
-- so they cannot drift out of date the way a projection table would, and there is no
-- second copy of the data to keep in step. Nothing writes to them, and dropping them
-- cannot affect the application.
--
-- Run in SQLyog AFTER 006 and 007. Order: 001 -> 002 -> 004 -> 005 -> 006 -> 007 -> 008
-- -> 009 -> 010 -> 003. Safe to re-run.

USE mis_ph_db;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Clients. capacity_clients is already a normal table; this only adds the email
-- of whoever created the row, which otherwise sits behind a join.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_capacity_clients AS
SELECT
  c.id,
  c.name,
  c.week_start,
  c.capacity_plan_start_week,
  c.planning_weeks,
  c.build_method,
  c.default_paid_hours,
  c.default_shrinkage_pct,
  u.email AS created_by_email,
  c.created_at,
  c.updated_at
FROM capacity_clients c
LEFT JOIN users u ON u.id = c.created_by;

-- ---------------------------------------------------------------------------
-- What each planner has stored, in one glance.
--
-- One row per saved document, labelled in plain English, with how many items it
-- holds and when it last changed. This is the quickest answer to "is my work in
-- the database?" and it works on every MariaDB version this app supports.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_capacity_storage AS
SELECT
  u.email AS owner_email,
  u.name AS owner_name,
  d.doc_key,
  CASE d.doc_key
    WHEN 'wfp-planner-scenarios-v2' THEN 'Staffing plans (one per client/LOB)'
    WHEN 'wfp-planner-scenarios-v1' THEN 'Staffing plans (superseded format)'
    WHEN 'wfp-dbe-lines-v3'         THEN 'DBE lines'
    WHEN 'wfp-dbe-lines-v2'         THEN 'DBE lines (superseded format)'
    WHEN 'wfp-dbe-lines-v1'         THEN 'DBE lines (superseded format)'
    WHEN 'wfp-capacity-plan-overrides-v1'       THEN 'Capacity grid overrides'
    WHEN 'wfp-ledger-actual-overrides-v1'       THEN 'Actuals ledger overrides'
    WHEN 'wfp-forecast-overrides-v1'            THEN 'Forecast overrides'
    WHEN 'wfp-aht-analysis-overrides-v1'        THEN 'AHT analysis overrides'
    WHEN 'wfp-capacity-shrinkage-categories-v1' THEN 'Shrinkage categories'
    WHEN 'wfp-capacity-stage-attrition-v1'      THEN 'Stage attrition'
    WHEN 'wfp-capacity-support-roles-v1'        THEN 'Support roles'
    WHEN 'wfp-capacity-forecast-modes-v1'       THEN 'Forecast modes'
    WHEN 'wfp-capacity-driver-week-locks-v1'    THEN 'Driver week locks'
    WHEN 'wfp-capacity-plan-previous-publish-v1' THEN 'Previously published plan'
    WHEN 'wfp-capacity-formula-overrides-v1'    THEN 'Formula text overrides'
    WHEN 'wfp-roster-store-v1'                  THEN 'Roster'
    WHEN 'wfp-roster-sync-meta-v1'              THEN 'Roster sync details'
    ELSE 'Other planning data'
  END AS contents,
  -- Item count only means something for a list; an object payload reports NULL.
  CASE
    WHEN JSON_VALID(d.payload) AND JSON_TYPE(d.payload) = 'ARRAY' THEN JSON_LENGTH(d.payload)
    ELSE NULL
  END AS item_count,
  d.revision,
  d.updated_at
FROM capacity_documents d
LEFT JOIN users u ON u.id = d.owner_user_id;

-- ---------------------------------------------------------------------------
-- Row-per-plan and row-per-DBE-line views.
--
-- These need JSON_TABLE to turn a JSON array into rows, which MariaDB added in
-- 10.6. On anything older they are skipped and v_capacity_storage above still
-- works, so the script succeeds either way rather than failing half applied.
-- ---------------------------------------------------------------------------

SET @version := VERSION();
SET @major := CAST(SUBSTRING_INDEX(@version, '.', 1) AS UNSIGNED);
SET @minor := CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(@version, '.', 2), '.', -1) AS UNSIGNED);
SET @has_json_table := (@major > 10) OR (@major = 10 AND @minor >= 6);

-- One row per staffing plan: a client/LOB team and its planning settings.
SET @sql := IF(
  @has_json_table,
  'CREATE OR REPLACE VIEW v_capacity_plans AS
     SELECT
       u.email AS planner_email,
       u.name  AS planner_name,
       s.scenario_id,
       s.scenario_name,
       s.client,
       s.lob,
       s.location,
       s.project_code,
       s.billing_type,
       s.planning_weeks,
       s.plan_start_week,
       d.updated_at
     FROM capacity_documents d
     LEFT JOIN users u ON u.id = d.owner_user_id
     JOIN JSON_TABLE(
       d.payload,
       ''$[*]'' COLUMNS (
         scenario_id     VARCHAR(64)  PATH ''$.id'',
         scenario_name   VARCHAR(255) PATH ''$.name'',
         client          VARCHAR(255) PATH ''$.plan.client'',
         lob             VARCHAR(255) PATH ''$.plan.lob'',
         location        VARCHAR(255) PATH ''$.plan.location'',
         project_code    VARCHAR(128) PATH ''$.plan.projectCode'',
         billing_type    VARCHAR(64)  PATH ''$.plan.billingType'',
         planning_weeks  INT          PATH ''$.plan.planningWeeks'',
         plan_start_week VARCHAR(32)  PATH ''$.plan.capacityPlanStartWeek''
       )
     ) AS s
     WHERE d.doc_key = ''wfp-planner-scenarios-v2''
       AND JSON_VALID(d.payload)
       AND JSON_TYPE(d.payload) = ''ARRAY''',
  'SELECT ''v_capacity_plans needs MariaDB 10.6+ (JSON_TABLE); skipped'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- One row per DBE line.
SET @sql := IF(
  @has_json_table,
  'CREATE OR REPLACE VIEW v_capacity_dbe AS
     SELECT
       u.email AS planner_email,
       u.name  AS planner_name,
       l.line_id,
       l.client,
       l.lob,
       l.location,
       l.project_code,
       l.billing_type,
       l.agent_group,
       l.bill_rate_method,
       d.updated_at
     FROM capacity_documents d
     LEFT JOIN users u ON u.id = d.owner_user_id
     JOIN JSON_TABLE(
       d.payload,
       ''$[*]'' COLUMNS (
         line_id          VARCHAR(64)  PATH ''$.id'',
         client           VARCHAR(255) PATH ''$.clientName'',
         lob              VARCHAR(255) PATH ''$.lobProjectName'',
         location         VARCHAR(255) PATH ''$.location'',
         project_code     VARCHAR(128) PATH ''$.projectCode'',
         billing_type     VARCHAR(64)  PATH ''$.billingType'',
         agent_group      VARCHAR(128) PATH ''$.agentGroup'',
         bill_rate_method VARCHAR(64)  PATH ''$.billRateMethod''
       )
     ) AS l
     WHERE d.doc_key = ''wfp-dbe-lines-v3''
       AND JSON_VALID(d.payload)
       AND JSON_TYPE(d.payload) = ''ARRAY''',
  'SELECT ''v_capacity_dbe needs MariaDB 10.6+ (JSON_TABLE); skipped'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Teams, the distinct client/LOB pairs being planned. In this application a team
-- is an LOB plan rather than a separate record, so this is a grouping of the view
-- above rather than a table of its own.
SET @sql := IF(
  @has_json_table,
  'CREATE OR REPLACE VIEW v_capacity_teams AS
     SELECT DISTINCT client, lob, location, planner_email
     FROM v_capacity_plans',
  'SELECT ''v_capacity_teams needs MariaDB 10.6+ (JSON_TABLE); skipped'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
