-- Capacity Plan — demo users for mis_ph_db (optional but recommended after 002 + 004 + 005)
--
-- SQLyog: Tools → Execute SQL Script → this file → Execute
-- Password for all demo accounts: movate
-- Prefer re-seeding via: cd capacity && npm run db:setup (uses same accounts)
--
-- Requires users.is_active (from updated 002 or 004) and Analyst CHECK (005) if seeding analyst.

USE mis_ph_db;

INSERT INTO users (id, email, password_hash, name, access_level, is_active)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'test@movate.com',
   '$2a$12$9u2qvPT8/UZ/vxKY9qNjLOk88qZ5gpIN.YVx/kxCU6K0pPhVPsSfu',
   'Test User', 'admin', 1),
  ('22222222-2222-4222-8222-222222222222', 'ben@movate.com',
   '$2a$12$9u2qvPT8/UZ/vxKY9qNjLOk88qZ5gpIN.YVx/kxCU6K0pPhVPsSfu',
   'Ben', 'director', 1),
  ('33333333-3333-4333-8333-333333333333', 'marian@movate.com',
   '$2a$12$9u2qvPT8/UZ/vxKY9qNjLOk88qZ5gpIN.YVx/kxCU6K0pPhVPsSfu',
   'Marian', 'cap_planner', 1)
ON DUPLICATE KEY UPDATE
  password_hash = VALUES(password_hash),
  name = VALUES(name),
  access_level = VALUES(access_level),
  is_active = 1;
