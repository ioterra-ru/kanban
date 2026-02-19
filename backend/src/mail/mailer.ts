import nodemailer from "nodemailer";
import { env } from "../env.js";
import { prisma } from "../prisma.js";

type SendEmailInput = {
  to: string[];
  subject: string;
  text: string;
};

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedKey: string | null = null;
let cachedFrom: string | null = null;
let cachedAt = 0;

type MailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

async function getMailConfig(): Promise<MailConfig | null> {
  try {
    const rec = await prisma.mailSettings.findUnique({
      where: { id: "mail" },
      select: { enabled: true, host: true, port: true, secure: true, user: true, pass: true, from: true },
    });

    // If admin configured settings exist, they are authoritative.
    if (rec) {
      if (!rec.enabled) return null;
      if (!rec.host || !rec.port || !rec.user || !rec.pass) return null;
      const from = rec.from ?? rec.user;
      if (!from) return null;
      return { enabled: true, host: rec.host, port: rec.port, secure: rec.secure, user: rec.user, pass: rec.pass, from };
    }
  } catch {
    // ignore and fall back to env
  }

  // Fallback to env (legacy)
  if (!env.SMTP_HOST) return null;
  if (!env.SMTP_USER || !env.SMTP_PASS) return null;
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? null;
  if (!from) return null;
  return {
    enabled: true,
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from,
  };
}

async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; from: string } | null> {
  const now = Date.now();
  if (cachedTransporter && cachedKey && cachedFrom && now - cachedAt < 30_000) {
    return { transporter: cachedTransporter, from: cachedFrom };
  }

  const cfg = await getMailConfig();
  if (!cfg) return null;

  const key = JSON.stringify({ host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, from: cfg.from });
  if (cachedTransporter && cachedKey === key && cachedFrom) {
    cachedAt = now;
    return { transporter: cachedTransporter, from: cachedFrom };
  }

  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // Keep the app responsive even if SMTP is blocked/down.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
  });
  cachedKey = key;
  cachedFrom = cfg.from;
  cachedAt = now;
  return { transporter: cachedTransporter, from: cachedFrom };
}

export async function sendEmail(input: SendEmailInput) {
  const t = await getTransporter();
  if (!t) {
    // eslint-disable-next-line no-console
    console.log("[email disabled]", { to: input.to, subject: input.subject, text: input.text });
    return;
  }

  try {
    await t.transporter.sendMail({
      from: t.from,
      to: input.to.join(","),
      subject: input.subject,
      text: input.text,
    });
  } catch (err) {
    // Never crash the app because SMTP is down/misconfigured.
    // eslint-disable-next-line no-console
    console.error("[email error]", {
      to: input.to,
      subject: input.subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

