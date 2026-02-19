import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";

import { prisma } from "../prisma.js";
import { HttpError } from "../utils/httpError.js";
import type { AuthUser } from "./types.js";

export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const userId = req.session.user?.userId;
  if (!userId) return null;

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarPreset: true,
      avatarUploadName: true,
      role: true,
      totpEnabled: true,
      mustChangePassword: true,
      defaultBoardId: true,
    },
  });
  return u ?? null;
}

export function requireLogin() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const u = await getAuthUser(req);
    if (!u) return next(new HttpError(401, "Unauthorized"));
    (req as Request & { user: AuthUser }).user = u;
    next();
  };
}

export function requireTwoFactor() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = (req as Request & { user?: AuthUser }).user;
    if (!u) return next(new HttpError(401, "Unauthorized"));
    if (!u.totpEnabled) return next(new HttpError(403, "2FA setup required"));
    if (!req.session.twoFactorPassed) return next(new HttpError(401, "Two-factor required"));
    next();
  };
}

export function requireAdmin() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = (req as Request & { user?: AuthUser }).user;
    if (!u) return next(new HttpError(401, "Unauthorized"));
    if (u.role !== Role.ADMIN) return next(new HttpError(403, "Forbidden"));
    next();
  };
}

