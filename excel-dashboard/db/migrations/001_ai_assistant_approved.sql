-- Safe migrations for existing Neon databases (idempotent)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS ai_assistant_approved BOOLEAN NOT NULL DEFAULT false;

UPDATE users SET ai_assistant_approved = true WHERE access_level = 'executive';
