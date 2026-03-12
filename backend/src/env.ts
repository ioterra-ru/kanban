import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t ? t : undefined;
}, z.string().min(1).optional());

const optionalUrl = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t ? t : undefined;
  }, z.string().url().optional());

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(16),
    APP_HOST: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().min(1).optional().default("localhost")),
    ENABLE_HTTPS: z
      .string()
      .optional()
      .transform((v) => (v ?? "true").toLowerCase() === "true"),
    FRONTEND_HTTP_PORT: z.coerce.number().int().positive().optional().default(8080),
    FRONTEND_HTTPS_PORT: z.coerce.number().int().positive().optional().default(8443),
    PUBLIC_BASE_URL: optionalUrl,
    CORS_ORIGIN: z.string().optional(),
    SMTP_HOST: optionalNonEmptyString,
    SMTP_PORT: z.preprocess((v) => {
      if (v === "" || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    }, z.number().int().positive().optional().default(587)),
    SMTP_USER: optionalNonEmptyString,
    SMTP_PASS: optionalNonEmptyString,
    SMTP_FROM: optionalNonEmptyString,
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => (v ?? "").toLowerCase())
      .pipe(z.enum(["", "true", "false"]))
      .transform((v) => v === "true"),
  })
  .transform((o) => {
    const base =
      o.PUBLIC_BASE_URL ??
      (() => {
        const scheme = o.ENABLE_HTTPS ? "https" : "http";
        const port = o.ENABLE_HTTPS ? o.FRONTEND_HTTPS_PORT : o.FRONTEND_HTTP_PORT;
        return `${scheme}://${o.APP_HOST}:${port}`.replace(/\/+$/, "");
      })();
    const corsOrigin =
      o.CORS_ORIGIN?.trim() ||
      (() => {
        const scheme = o.ENABLE_HTTPS ? "https" : "http";
        const port = o.ENABLE_HTTPS ? o.FRONTEND_HTTPS_PORT : o.FRONTEND_HTTP_PORT;
        return `${base},${scheme}://localhost:${port},${scheme}://127.0.0.1:${port}`;
      })();
    const { PUBLIC_BASE_URL: _u, CORS_ORIGIN: _c, ...rest } = o;
    return { ...rest, PUBLIC_BASE_URL: base, CORS_ORIGIN: corsOrigin };
  });

export const env = EnvSchema.parse(process.env);
