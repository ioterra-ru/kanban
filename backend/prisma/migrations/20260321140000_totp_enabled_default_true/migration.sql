-- New users get 2FA required by default; existing rows unchanged.
ALTER TABLE "User" ALTER COLUMN "totpEnabled" SET DEFAULT true;
