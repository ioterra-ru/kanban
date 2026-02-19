-- Add description to boards

ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "description" TEXT;

