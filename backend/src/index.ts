import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { ZodError } from "zod";

import { env } from "./env.js";
import { router } from "./routes.js";
import { HttpError } from "./utils/httpError.js";
import { createSessionMiddleware } from "./auth/session.js";
import { authRouter } from "./auth/routes.js";
import { ensureDefaultAdmin } from "./auth/defaultAdmin.js";

const app = express();
// We are behind nginx (TLS termination) in docker-compose.
// This is required so req.secure works and secure cookies can be set.
app.set("trust proxy", 1);

const uploadsDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const corsOrigins = env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
const corsOriginSet = new Set(corsOrigins);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser clients (no Origin header)
      if (!origin) return cb(null, true);
      // allow all if list is empty
      if (corsOriginSet.size === 0) return cb(null, true);
      return cb(null, corsOriginSet.has(origin));
    },
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(createSessionMiddleware());

app.get("/health", (_req, res) => res.json({ ok: true }));

// NOTE: do not expose raw uploads without auth. Use /api/attachments/:id/download instead.
app.use("/api/auth", authRouter);
app.use("/api", router);

// Error handler must be last
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Validation error", details: err.issues });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  },
);

async function start() {
  await ensureDefaultAdmin();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", err);
  process.exitCode = 1;
});

