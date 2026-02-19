-- Add user avatars (preset + uploaded photo reference)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarPreset" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUploadName" TEXT;

