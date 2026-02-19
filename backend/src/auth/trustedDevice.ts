import crypto from "node:crypto";
import type { Request, Response } from "express";

import { prisma } from "../prisma.js";

const COOKIE_NAME = "ioterra.2fa_trust";
const DAYS = 30;

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function getTrustedDeviceCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k !== COOKIE_NAME) continue;
    return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

export async function verifyTrustedDeviceToken(input: { userId: string; token: string; now?: Date }) {
  const now = input.now ?? new Date();
  const tokenHash = sha256Hex(input.token);
  const d = await prisma.trustedDevice.findFirst({
    where: { userId: input.userId, tokenHash, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (!d) return false;
  await prisma.trustedDevice.update({ where: { id: d.id }, data: { lastUsedAt: now } });
  return true;
}

export async function issueTrustedDevice(input: { userId: string; req: Request; res: Response }) {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);

  await prisma.trustedDevice.create({
    data: {
      userId: input.userId,
      tokenHash,
      userAgent: input.req.headers["user-agent"] ?? null,
      expiresAt,
      lastUsedAt: new Date(),
    },
  });

  input.res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

