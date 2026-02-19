import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";

import { env } from "../env.js";

const PgSession = connectPgSimple(session);

export type SessionDataUser = {
  userId: string;
};

declare module "express-session" {
  interface SessionData {
    user?: SessionDataUser;
    twoFactorPassed?: boolean;
    boardId?: string;
  }
}

export function createSessionMiddleware() {
  const pgPool = new pg.Pool({ connectionString: env.DATABASE_URL });

  return session({
    name: "ioterra.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
    store: new PgSession({
      pool: pgPool,
      tableName: "session",
      createTableIfMissing: true,
    }),
  });
}

