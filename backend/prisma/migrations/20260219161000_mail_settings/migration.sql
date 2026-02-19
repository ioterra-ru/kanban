-- Mail settings stored in DB (admin-configurable)
CREATE TABLE IF NOT EXISTS "MailSettings" (
  "id" TEXT PRIMARY KEY DEFAULT 'mail',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "host" TEXT,
  "port" INTEGER,
  "secure" BOOLEAN NOT NULL DEFAULT true,
  "user" TEXT,
  "pass" TEXT,
  "from" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure singleton row exists
INSERT INTO "MailSettings" ("id") VALUES ('mail')
ON CONFLICT ("id") DO NOTHING;

