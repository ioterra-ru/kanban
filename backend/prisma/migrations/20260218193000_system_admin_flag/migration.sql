-- Mark system (built-in) users

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false;

