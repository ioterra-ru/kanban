import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().optional().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const t = v.trim();
      return t ? t : undefined;
    }, z.string().url().optional()),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => (v ?? "").toLowerCase())
    .pipe(z.enum(["", "true", "false"]))
    .transform((v) => v === "true"),
});

export const env = EnvSchema.parse(process.env);

