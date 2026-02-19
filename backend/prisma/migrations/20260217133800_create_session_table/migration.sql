-- Session table used by connect-pg-simple (express-session store)
-- This migration exists to ensure shadow DB can apply later session alterations.

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

