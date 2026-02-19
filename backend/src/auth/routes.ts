import express from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { Role } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import nodemailer from "nodemailer";

import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "./totp.js";
import { requireAdmin, requireLogin, requireTwoFactor } from "./middleware.js";
import { getTrustedDeviceCookie, issueTrustedDevice, verifyTrustedDeviceToken } from "./trustedDevice.js";
import crypto from "node:crypto";
import { sendEmail } from "../mail/mailer.js";
import { env } from "../env.js";
import { BoardIdSchema, DEFAULT_BOARD_ID } from "../boards/ids.js";
import { AVATAR_PRESETS, isAvatarPreset, randomAvatarPreset } from "./avatarPresets.js";

export const authRouter = express.Router();

const AvatarPresetSchema = z
  .union([z.string().min(1), z.null()])
  .optional()
  .refine((v) => v === undefined || v === null || isAvatarPreset(v), "Invalid avatar preset");

authRouter.get(
  "/profile",
  requireLogin(),
  requireTwoFactor(),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarPreset: true,
        avatarUploadName: true,
        role: true,
        defaultBoardId: true,
        totpEnabled: true,
        mustChangePassword: true,
      },
    });
    res.json({ user: u });
  }),
);

const UpdateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  defaultBoardId: BoardIdSchema.optional(),
  avatarPreset: AvatarPresetSchema,
});

authRouter.patch(
  "/profile",
  requireLogin(),
  requireTwoFactor(),
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { id: string; role: Role };
    const data = UpdateProfileSchema.parse(req.body);

    if (data.email) {
      const existing = await prisma.user.findFirst({
        where: { email: { equals: data.email, mode: "insensitive" }, NOT: { id: user.id } },
        select: { id: true },
      });
      if (existing) throw new HttpError(400, "Email already exists");
    }

    if (data.defaultBoardId) {
      if (user.role !== Role.ADMIN) {
        const has = await prisma.boardMembership.findUnique({
          where: { boardId_userId: { boardId: data.defaultBoardId, userId: user.id } },
          select: { boardId: true },
        });
        if (!has) throw new HttpError(403, "Forbidden");
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.defaultBoardId !== undefined ? { defaultBoardId: data.defaultBoardId } : {}),
        ...(data.avatarPreset !== undefined ? { avatarPreset: data.avatarPreset } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarPreset: true,
        avatarUploadName: true,
        role: true,
        defaultBoardId: true,
        totpEnabled: true,
        mustChangePassword: true,
      },
    });

    if (data.defaultBoardId) {
      req.session.boardId = data.defaultBoardId;
      await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    }

    res.json({ user: updated, currentBoardId: req.session.boardId ?? null });
  }),
);

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const userId = req.session.user?.userId ?? null;
    if (!userId) {
      res.json({ user: null });
      return;
    }
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
    res.json({
      user: u ?? null,
      twoFactorPassed: !!req.session.twoFactorPassed,
      currentBoardId: req.session.boardId ?? null,
    });
  }),
);

const LoginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().min(6).max(8).optional(),
  rememberDevice: z.boolean().optional().default(false),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { login, password, totp, rememberDevice } = LoginSchema.parse(req.body);
    const normalized = login.trim();
    const lower = normalized.toLowerCase();

    const u = await (async () => {
      if (lower === "admin") {
        return await prisma.user.findFirst({
          where: { email: { equals: "admin@local", mode: "insensitive" } },
        });
      }

      if (normalized.includes("@")) {
        return await prisma.user.findFirst({
          where: { email: { equals: normalized, mode: "insensitive" } },
        });
      }

      const matches = await prisma.user.findMany({
        where: { name: { equals: normalized, mode: "insensitive" } },
        take: 2,
      });
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new HttpError(400, "Ambiguous login, use email");
      return null;
    })();

    if (!u) throw new HttpError(401, "Invalid credentials");
    const ok = await verifyPassword(password, u.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid credentials");

    // 2FA required if enabled
    if (u.totpEnabled) {
      if (!u.totpSecret) throw new HttpError(500, "2FA misconfigured");
      if (totp) {
        const valid = verifyTotp({ token: totp, secret: u.totpSecret });
        if (!valid) throw new HttpError(401, "Invalid 2FA code");
        if (rememberDevice) {
          await issueTrustedDevice({ userId: u.id, req, res });
        }
      } else {
        const token = getTrustedDeviceCookie(req);
        const ok = token ? await verifyTrustedDeviceToken({ userId: u.id, token }) : false;
        if (!ok) throw new HttpError(401, "Two-factor required");
      }
    }

    req.session.user = { userId: u.id };
    req.session.twoFactorPassed = !u.totpEnabled ? false : true;

    // set current board to user's default board (or first membership)
    const defaultBoardId = u.defaultBoardId ?? null;
    if (defaultBoardId) {
      req.session.boardId = defaultBoardId;
    } else {
      const m = await prisma.boardMembership.findFirst({
        where: { userId: u.id },
        orderBy: { createdAt: "asc" },
        select: { boardId: true },
      });
      if (m?.boardId) req.session.boardId = m.boardId;
      else delete req.session.boardId;
    }

    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        avatarPreset: u.avatarPreset,
        avatarUploadName: u.avatarUploadName,
        role: u.role,
        totpEnabled: u.totpEnabled,
        mustChangePassword: u.mustChangePassword,
        defaultBoardId: u.defaultBoardId,
      },
      twoFactorPassed: !!req.session.twoFactorPassed,
      currentBoardId: req.session.boardId ?? null,
    });
  }),
);

const avatarUploadRoot = path.join(process.cwd(), "uploads", "avatars");
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      fs.mkdirSync(avatarUploadRoot, { recursive: true });
      cb(null, avatarUploadRoot);
    } catch (e) {
      cb(e as Error, avatarUploadRoot);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 12);
    cb(null, `${crypto.randomUUID()}${ext || ""}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

authRouter.get(
  "/avatar/:id",
  requireLogin(),
  requireTwoFactor(),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const u = await prisma.user.findUnique({ where: { id }, select: { avatarUploadName: true } });
    if (!u?.avatarUploadName) throw new HttpError(404, "Avatar not found");
    const abs = path.join(avatarUploadRoot, u.avatarUploadName);
    if (!fs.existsSync(abs)) throw new HttpError(404, "Avatar not found");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(abs);
  }),
);

authRouter.post(
  "/profile/avatar",
  requireLogin(),
  requireTwoFactor(),
  avatarUpload.single("file"),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    if (!req.file) throw new HttpError(400, "File is required");

    const prev = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUploadName: true } });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUploadName: req.file.filename },
      select: {
        id: true,
        email: true,
        name: true,
        avatarPreset: true,
        avatarUploadName: true,
        role: true,
        defaultBoardId: true,
        totpEnabled: true,
        mustChangePassword: true,
      },
    });

    if (prev?.avatarUploadName && prev.avatarUploadName !== req.file.filename) {
      const absPrev = path.join(avatarUploadRoot, prev.avatarUploadName);
      fs.promises.unlink(absPrev).catch(() => undefined);
    }

    res.json({ user: updated });
  }),
);

authRouter.delete(
  "/profile/avatar",
  requireLogin(),
  requireTwoFactor(),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    const prev = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUploadName: true } });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUploadName: null },
      select: {
        id: true,
        email: true,
        name: true,
        avatarPreset: true,
        avatarUploadName: true,
        role: true,
        defaultBoardId: true,
        totpEnabled: true,
        mustChangePassword: true,
      },
    });
    if (prev?.avatarUploadName) {
      const absPrev = path.join(avatarUploadRoot, prev.avatarUploadName);
      fs.promises.unlink(absPrev).catch(() => undefined);
    }
    res.json({ user: updated });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: "Failed to logout" });
        return;
      }
      res.clearCookie("ioterra.sid");
      res.json({ ok: true });
    });
  }),
);

const ChangePasswordSchema = z.object({
  newPassword: z.string().min(8),
});

authRouter.post(
  "/password",
  requireLogin(),
  asyncHandler(async (req, res) => {
    const { newPassword } = ChangePasswordSchema.parse(req.body);
    const userId = (req as any).user.id as string;
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    res.json({ ok: true });
  }),
);

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function baseUrl(req: express.Request) {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const host = req.get("host") ?? "localhost:8443";
  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "https").toString();
  return `${proto}://${host}`;
}

const ForgotPasswordSchema = z.object({
  login: z.string().min(1),
});

authRouter.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const { login } = ForgotPasswordSchema.parse(req.body);
    const normalized = login.trim();
    const lower = normalized.toLowerCase();

    // Always return ok to avoid user enumeration.
    const respondOk = () => {
      res.json({ ok: true });
    };

    if (!normalized) {
      respondOk();
      return;
    }

    const u = await (async () => {
      if (normalized.includes("@")) {
        return await prisma.user.findFirst({
          where: { email: { equals: normalized, mode: "insensitive" } },
          select: { id: true, email: true, name: true },
        });
      }
      const matches = await prisma.user.findMany({
        where: { name: { equals: lower, mode: "insensitive" } },
        take: 2,
        select: { id: true, email: true, name: true },
      });
      if (matches.length === 1) return matches[0];
      return null;
    })();

    if (!u?.email) {
      respondOk();
      return;
    }

    // Only create tokens when mail is enabled & configured.
    const ms = await prisma.mailSettings
      .findUnique({ where: { id: "mail" }, select: { enabled: true, host: true, port: true, user: true, pass: true } })
      .catch(() => null);
    const mailConfigured =
      ms?.enabled && !!ms.host && !!ms.port && !!ms.user && !!ms.pass ? true : !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
    if (!mailConfigured) {
      respondOk();
      return;
    }

    const token = randomToken();
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h

    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash, expiresAt },
    });

    const link = `${baseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: [u.email],
      subject: "Сброс пароля — ИоТерра-Канбан",
      text: [
        `Здравствуйте, ${u.name ?? u.email}.`,
        "",
        "Кто-то запросил сброс пароля для вашей учетной записи в ИоТерра-Канбан.",
        "Если это были вы — перейдите по ссылке и задайте новый пароль:",
        link,
        "",
        "Ссылка действует 1 час. Если вы не запрашивали сброс — просто игнорируйте это письмо.",
      ].join("\n"),
    });

    respondOk();
  }),
);

// Admin: mail settings (stored in DB)
const MailSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string().min(1).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  secure: z.boolean().optional().nullable(),
  user: z.string().min(1).optional().nullable(),
  pass: z.string().min(1).optional().nullable(),
  from: z.string().min(1).optional().nullable(),
});

authRouter.get(
  "/mail-settings",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const rec = await prisma.mailSettings.findUnique({ where: { id: "mail" } });
    const enabled = rec?.enabled ?? false;
    res.json({
      settings: {
        enabled,
        host: rec?.host ?? "",
        port: rec?.port ?? 465,
        secure: rec?.secure ?? true,
        user: rec?.user ?? "",
        from: rec?.from ?? "",
        passSet: !!rec?.pass,
      },
    });
  }),
);

authRouter.put(
  "/mail-settings",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const data = MailSettingsSchema.parse(req.body);
    const prev = await prisma.mailSettings.findUnique({ where: { id: "mail" }, select: { pass: true } });

    if (data.enabled) {
      const host = data.host ?? undefined;
      const port = data.port ?? undefined;
      const user = data.user ?? undefined;
      const pass = (data.pass ?? undefined) ?? prev?.pass ?? undefined;
      if (!host || !port || !user || !pass) throw new HttpError(400, "SMTP not configured");
    }

    const next = await prisma.mailSettings.upsert({
      where: { id: "mail" },
      create: {
        id: "mail",
        enabled: data.enabled,
        host: data.host ?? null,
        port: data.port ?? null,
        secure: data.secure ?? true,
        user: data.user ?? null,
        pass: data.pass ?? null,
        from: data.from ?? null,
      },
      update: {
        enabled: data.enabled,
        ...(data.host !== undefined ? { host: data.host } : {}),
        ...(data.port !== undefined ? { port: data.port } : {}),
        ...(data.secure !== undefined ? { secure: data.secure ?? true } : {}),
        ...(data.user !== undefined ? { user: data.user } : {}),
        ...(data.from !== undefined ? { from: data.from } : {}),
        ...(data.pass !== undefined ? { pass: data.pass } : {}),
      },
    });

    res.json({
      settings: {
        enabled: next.enabled,
        host: next.host ?? "",
        port: next.port ?? 465,
        secure: next.secure,
        user: next.user ?? "",
        from: next.from ?? "",
        passSet: !!next.pass,
      },
    });
  }),
);

const MailSettingsTestSchema = z.object({
  host: z.string().min(1).optional().nullable(),
  port: z.number().int().min(1).max(65535).optional().nullable(),
  secure: z.boolean().optional().nullable(),
  user: z.string().min(1).optional().nullable(),
  pass: z.string().min(1).optional().nullable(),
  from: z.string().min(1).optional().nullable(),
});

authRouter.post(
  "/mail-settings/test",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const data = MailSettingsTestSchema.parse(req.body);
    const saved = await prisma.mailSettings.findUnique({
      where: { id: "mail" },
      select: { enabled: true, host: true, port: true, secure: true, user: true, pass: true, from: true },
    });

    const host = (data.host ?? saved?.host ?? "").toString();
    const port = Number(data.port ?? saved?.port ?? 0);
    const secure = Boolean(data.secure ?? saved?.secure ?? true);
    const user = (data.user ?? saved?.user ?? "").toString();
    const pass = (data.pass ?? saved?.pass ?? "").toString();
    const from = (data.from ?? saved?.from ?? user ?? "").toString();

    if (!host || !port || !user || !pass) {
      res.json({ ok: false, error: "SMTP not configured" });
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 8_000,
      });
      await transporter.verify();
      res.json({ ok: true, from });
    } catch (e) {
      const code = (e as any)?.code as string | undefined;
      const msg = (e as any)?.message as string | undefined;
      res.json({ ok: false, error: code ? `${code}${msg ? `: ${msg}` : ""}` : msg ?? "Unknown error" });
    }
  }),
);

const ResetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8),
});

authRouter.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const { token, newPassword } = ResetPasswordSchema.parse(req.body);
    const tokenHash = sha256Hex(token);
    const now = new Date();

    const rec = await prisma.passwordResetToken.findFirst({
      where: { tokenHash, expiresAt: { gt: now }, usedAt: null },
      select: { id: true, userId: true },
    });
    if (!rec) throw new HttpError(400, "Invalid or expired token");

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: rec.userId },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: now } });
      await tx.$executeRaw`DELETE FROM "session" WHERE (sess->'user'->>'userId') = ${rec.userId}`;
    });

    res.json({ ok: true });
  }),
);

const ResetPasswordByTotpSchema = z.object({
  login: z.string().min(1),
  code: z.string().min(6).max(8),
  newPassword: z.string().min(8),
});

authRouter.post(
  "/password/reset-by-totp",
  asyncHandler(async (req, res) => {
    const { login, code, newPassword } = ResetPasswordByTotpSchema.parse(req.body);
    const normalized = login.trim();
    const lower = normalized.toLowerCase();

    const u = await (async () => {
      if (normalized.includes("@")) {
        return await prisma.user.findFirst({
          where: { email: { equals: normalized, mode: "insensitive" } },
          select: { id: true, totpEnabled: true, totpSecret: true },
        });
      }
      const matches = await prisma.user.findMany({
        where: { name: { equals: lower, mode: "insensitive" } },
        take: 2,
        select: { id: true, totpEnabled: true, totpSecret: true },
      });
      if (matches.length === 1) return matches[0];
      return null;
    })();

    if (!u?.totpEnabled || !u.totpSecret) throw new HttpError(400, "Password reset not available");
    const ok = verifyTotp({ token: code.trim(), secret: u.totpSecret });
    if (!ok) throw new HttpError(400, "Invalid code");

    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { passwordHash, mustChangePassword: false } });
      await tx.$executeRaw`DELETE FROM "session" WHERE (sess->'user'->>'userId') = ${u.id}`;
      await tx.trustedDevice.deleteMany({ where: { userId: u.id } });
    });

    res.json({ ok: true });
  }),
);

authRouter.post(
  "/2fa/setup",
  requireLogin(),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new HttpError(404, "User not found");
    const secret = generateTotpSecret();
    const url = otpauthUrl({ email: u.email, issuer: "IoTerra-Kanban", secret });
    const qrDataUrl = await QRCode.toDataURL(url);
    await prisma.user.update({
      where: { id: userId },
      data: { totpTempSecret: secret },
    });
    res.json({ secret, otpauthUrl: url, qrDataUrl });
  }),
);

const Enable2FASchema = z.object({
  code: z.string().min(6).max(8),
});

authRouter.post(
  "/2fa/enable",
  requireLogin(),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    const { code } = Enable2FASchema.parse(req.body);
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.totpTempSecret) throw new HttpError(400, "No 2FA setup in progress");
    const ok = verifyTotp({ token: code, secret: u.totpTempSecret });
    if (!ok) throw new HttpError(400, "Invalid code");
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        totpSecret: u.totpTempSecret,
        totpTempSecret: null,
      },
    });
    req.session.twoFactorPassed = true;
    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    res.json({ ok: true });
  }),
);

const Verify2FASchema = z.object({
  code: z.string().min(6).max(8),
  rememberDevice: z.boolean().optional().default(false),
});

authRouter.post(
  "/2fa/verify",
  requireLogin(),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user.id as string;
    const { code, rememberDevice } = Verify2FASchema.parse(req.body);
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.totpEnabled || !u.totpSecret) throw new HttpError(400, "2FA not enabled");
    const ok = verifyTotp({ token: code, secret: u.totpSecret });
    if (!ok) throw new HttpError(400, "Invalid code");
    req.session.twoFactorPassed = true;
    if (rememberDevice) {
      await issueTrustedDevice({ userId, req, res });
    }
    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    res.json({ ok: true });
  }),
);

// Admin user management
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional().default("MEMBER"),
  password: z.string().min(8),
});

authRouter.get(
  "/users",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        avatarPreset: true,
        avatarUploadName: true,
        role: true,
        isSystem: true,
        totpEnabled: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });
    res.json({ users });
  }),
);

authRouter.post(
  "/users",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const data = CreateUserSchema.parse(req.body);
    const boardId =
      req.session.boardId ??
      (await prisma.board.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
    if (!boardId) throw new HttpError(500, "No boards exist");
    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name ?? data.email.split("@")[0],
        avatarPreset: randomAvatarPreset(),
        role: data.role === "ADMIN" ? Role.ADMIN : Role.MEMBER,
        passwordHash,
        mustChangePassword: true,
        totpEnabled: false,
        defaultBoardId: boardId,
        boardMemberships: { create: { boardId } },
      },
      select: { id: true, email: true, name: true, avatarPreset: true, avatarUploadName: true, role: true, defaultBoardId: true, createdAt: true },
    });
    res.status(201).json({ user });
  }),
);

const ResetUserPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

const AdminUpdateUserSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
});

authRouter.post(
  "/users/:id/password",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { newPassword } = ResetUserPasswordSchema.parse(req.body);
    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    res.json({ ok: true });
  }),
);

authRouter.patch(
  "/users/:id",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const data = AdminUpdateUserSchema.parse(req.body);

    const u = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isSystem: true, defaultBoardId: true },
    });
    if (!u) throw new HttpError(404, "User not found");

    if (u.isSystem) {
      if (data.role !== undefined) throw new HttpError(400, "Cannot change role for system admin");
    }

    if (data.role === "MEMBER" && u.role === Role.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) throw new HttpError(400, "Cannot demote last admin");
    }

    if (data.email) {
      const existing = await prisma.user.findFirst({
        where: { email: { equals: data.email, mode: "insensitive" }, NOT: { id } },
        select: { id: true },
      });
      if (existing) throw new HttpError(400, "Email already exists");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextRole =
        data.role !== undefined ? (data.role === "ADMIN" ? Role.ADMIN : Role.MEMBER) : (u.role as Role);

      // If demoting to MEMBER, ensure at least one board membership exists.
      if (nextRole === Role.MEMBER) {
        const count = await tx.boardMembership.count({ where: { userId: id } });
        if (count === 0) {
          const boardId =
            u.defaultBoardId ??
            (await tx.board.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ??
            DEFAULT_BOARD_ID;
          await tx.boardMembership.create({ data: { boardId, userId: id } });
          await tx.user.update({ where: { id }, data: { defaultBoardId: boardId } });
        }
      }

      return await tx.user.update({
        where: { id },
        data: {
          ...(data.email !== undefined ? { email: data.email } : {}),
          ...(data.role !== undefined ? { role: data.role === "ADMIN" ? Role.ADMIN : Role.MEMBER } : {}),
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isSystem: true,
          totpEnabled: true,
          mustChangePassword: true,
          createdAt: true,
        },
      });
    });

    res.json({ user: updated });
  }),
);

authRouter.delete(
  "/users/:id",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const actor = (req as any).user as { id: string };
    const id = z.string().uuid().parse(req.params.id);
    if (id === actor.id) throw new HttpError(400, "Cannot delete yourself");

    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isSystem: true } });
    if (!u) throw new HttpError(404, "User not found");
    if (u.isSystem) throw new HttpError(400, "Cannot delete system admin");

    if (u.role === Role.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) throw new HttpError(400, "Cannot delete last admin");
    }

    // Best-effort: drop sessions for this user in connect-pg-simple table
    await prisma
      .$executeRaw`DELETE FROM "session" WHERE (sess->'user'->>'userId') = ${id}`
      .catch(() => {
      // ignore
    });

    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// Admin: manage board memberships + default board for a user
authRouter.get(
  "/users/:id/boards",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, defaultBoardId: true, role: true, isSystem: true } });
    if (!user) throw new HttpError(404, "User not found");
    if (user.role === Role.ADMIN || user.isSystem) throw new HttpError(400, "Admins have access to all boards");
    const boards = await prisma.board.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    const memberships = await prisma.boardMembership.findMany({ where: { userId: id }, select: { boardId: true } });
    const set = new Set(memberships.map((m) => m.boardId));
    res.json({
      defaultBoardId: user.defaultBoardId,
      boards: boards.map((b) => ({ ...b, hasAccess: set.has(b.id) })),
    });
  }),
);

const SetUserBoardsSchema = z.object({
  boardIds: z.array(BoardIdSchema).min(1),
  defaultBoardId: BoardIdSchema,
});

authRouter.put(
  "/users/:id/boards",
  requireLogin(),
  requireTwoFactor(),
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isSystem: true } });
    if (!user) throw new HttpError(404, "User not found");
    if (user.role === Role.ADMIN || user.isSystem) throw new HttpError(400, "Admins have access to all boards");
    const data = SetUserBoardsSchema.parse(req.body);
    if (!data.boardIds.includes(data.defaultBoardId)) {
      throw new HttpError(400, "defaultBoardId must be included in boardIds");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { defaultBoardId: data.defaultBoardId } });
      await tx.boardMembership.deleteMany({ where: { userId: id, boardId: { notIn: data.boardIds } } });
      for (const boardId of data.boardIds) {
        await tx.boardMembership.upsert({
          where: { boardId_userId: { boardId, userId: id } },
          create: { boardId, userId: id },
          update: {},
        });
      }
    });

    res.json({ ok: true });
  }),
);

