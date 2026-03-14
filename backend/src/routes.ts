import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "./prisma.js";
import { DEFAULT_COLUMN_TITLES } from "./columns.js";
import { ImportanceIds } from "./domain.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { HttpError } from "./utils/httpError.js";
import { requireLogin, requireTwoFactor } from "./auth/middleware.js";
import { Role } from "@prisma/client";
import { sendEmail } from "./mail/mailer.js";
import { BoardIdSchema } from "./boards/ids.js";
import {
  createCardArchive,
  deleteArchiveFile,
  getArchiveAbsolutePath,
  listArchiveFilenames,
  restoreCardFromArchive,
} from "./archive.js";

const router = express.Router();

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

router.use(requireLogin(), requireTwoFactor());

const SelectBoardSchema = z.object({
  boardId: BoardIdSchema,
});

router.get(
  "/boards",
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { id: string; role: Role };
    const boards =
      user.role === Role.ADMIN
        ? await prisma.board
            .findMany({
              orderBy: { name: "asc" },
              select: { id: true, name: true, description: true, memberships: { select: { userId: true } } },
            })
            .then((rows) =>
              rows.map((b) => ({
                id: b.id,
                name: b.name,
                description: b.description,
                memberIds: b.memberships.map((m) => m.userId),
              })),
            )
        : await prisma.boardMembership
            .findMany({
              where: { userId: user.id },
              orderBy: { createdAt: "asc" },
              select: { board: { select: { id: true, name: true, description: true } } },
            })
            .then((rows) =>
              rows.map((r) => ({
                id: r.board.id,
                name: r.board.name,
                description: r.board.description,
              })),
            );

    res.json({ boards, currentBoardId: req.session.boardId ?? null });
  }),
);

router.post(
  "/boards/select",
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { id: string; role: Role };
    const { boardId } = SelectBoardSchema.parse(req.body);
    if (user.role !== Role.ADMIN) {
      const has = await prisma.boardMembership.findUnique({
        where: { boardId_userId: { boardId, userId: user.id } },
        select: { boardId: true },
      });
      if (!has) throw new HttpError(403, "Forbidden");
    }
    req.session.boardId = boardId;
    await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    res.json({ ok: true, currentBoardId: boardId });
  }),
);

const CreateBoardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  memberIds: z.array(z.string().uuid()).optional().default([]),
});

const UpdateBoardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  memberIds: z.array(z.string().uuid()).optional(),
});

router.post(
  "/boards",
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { id: string; role: Role };
    if (user.role !== Role.ADMIN) throw new HttpError(403, "Forbidden");
    const { name, description, memberIds } = CreateBoardSchema.parse(req.body);
    const uniqMemberIds = Array.from(new Set([user.id, ...memberIds]));
    const board = await prisma.$transaction(async (tx) => {
      const b = await tx.board.create({
        data: { name, description: description ?? null },
        select: { id: true, name: true, description: true },
      });
      await tx.boardColumn.createMany({
        data: DEFAULT_COLUMN_TITLES.map((title, position) => ({
          boardId: b.id,
          title,
          position,
        })),
      });
      if (uniqMemberIds.length > 0) {
        await tx.boardMembership.createMany({
          data: uniqMemberIds.map((userId) => ({ boardId: b.id, userId })),
          skipDuplicates: true,
        });
      }
      return { ...b, memberIds: uniqMemberIds };
    });
    res.status(201).json({ board });
  }),
);

router.patch(
  "/boards/:id",
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { role: Role };
    if (user.role !== Role.ADMIN) throw new HttpError(403, "Forbidden");
    const id = BoardIdSchema.parse(req.params.id);
    const data = UpdateBoardSchema.parse(req.body);
    const board = await prisma.$transaction(async (tx) => {
      const updated = await tx.board.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
        select: { id: true, name: true, description: true },
      });

      if (data.memberIds !== undefined) {
        const next = Array.from(new Set(data.memberIds));
        const existing = await tx.boardMembership.findMany({
          where: { boardId: id },
          select: { userId: true },
        });
        const existingSet = new Set(existing.map((m) => m.userId));
        const nextSet = new Set(next);

        const toRemove = existing.filter((m) => !nextSet.has(m.userId)).map((m) => m.userId);
        const toAdd = next.filter((uid) => !existingSet.has(uid));

        if (toRemove.length > 0) {
          await tx.boardMembership.deleteMany({ where: { boardId: id, userId: { in: toRemove } } });

          // If someone lost this board and it was their default, pick another accessible board (or null).
          const needing = await tx.user.findMany({
            where: { id: { in: toRemove }, defaultBoardId: id },
            select: { id: true },
          });
          for (const u of needing) {
            const fallback = await tx.boardMembership.findFirst({
              where: { userId: u.id, boardId: { not: id } },
              orderBy: { createdAt: "asc" },
              select: { boardId: true },
            });
            await tx.user.update({
              where: { id: u.id },
              data: { defaultBoardId: fallback?.boardId ?? null },
            });
          }
        }

        if (toAdd.length > 0) {
          await tx.boardMembership.createMany({
            data: toAdd.map((userId) => ({ boardId: id, userId })),
            skipDuplicates: true,
          });
        }
      }

      const memberIds = await tx.boardMembership
        .findMany({ where: { boardId: id }, select: { userId: true }, orderBy: { createdAt: "asc" } })
        .then((rows) => rows.map((r) => r.userId));

      return { ...updated, memberIds };
    });

    res.json({ board });
  }),
);

router.delete(
  "/boards/:id",
  asyncHandler(async (req, res) => {
    const user = (req as any).user as { role: Role };
    if (user.role !== Role.ADMIN) throw new HttpError(403, "Forbidden");
    const id = BoardIdSchema.parse(req.params.id);
    const boardCount = await prisma.board.count();
    if (boardCount <= 1) throw new HttpError(400, "Cannot delete the last board");

    await prisma.$transaction(async (tx) => {
      // Re-point users whose default board is being deleted
      const affected = await tx.user.findMany({ where: { defaultBoardId: id }, select: { id: true } });
      for (const u of affected) {
        const fallback = await tx.boardMembership.findFirst({
          where: { userId: u.id, boardId: { not: id } },
          orderBy: { createdAt: "asc" },
          select: { boardId: true },
        });
        await tx.user.update({ where: { id: u.id }, data: { defaultBoardId: fallback?.boardId ?? null } });
      }

      await tx.board.delete({ where: { id } });
    });

    // if current session is on this board, unset it
    if (req.session.boardId === id) {
      delete req.session.boardId;
      await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
    }
    res.json({ ok: true });
  }),
);

function requireAdmin() {
  return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as { role: Role };
    if (user.role !== Role.ADMIN) throw new HttpError(403, "Forbidden");
    next();
  };
}

const BoardColumnsBoardIdSchema = z.object({ boardId: BoardIdSchema });
const BoardColumnIdParamSchema = z.object({ boardId: BoardIdSchema, columnId: z.string().uuid() });

router.get(
  "/boards/:boardId/columns",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { boardId } = BoardColumnsBoardIdSchema.parse(req.params);
    const columns = await prisma.boardColumn.findMany({
      where: { boardId },
      orderBy: { position: "asc" },
      select: { id: true, title: true, position: true, _count: { select: { cards: true } } },
    });
    res.json({ columns });
  }),
);

const CreateBoardColumnSchema = z.object({
  title: z.string().min(1).max(200),
  position: z.number().int().min(0).optional(),
});

router.post(
  "/boards/:boardId/columns",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { boardId } = BoardColumnsBoardIdSchema.parse(req.params);
    const body = CreateBoardColumnSchema.parse(req.body);
    const board = await prisma.board.findUnique({
      where: { id: boardId },
      select: { id: true },
    });
    if (!board) throw new HttpError(404, "Доска не найдена");
    const existing = await prisma.boardColumn.findMany({
      where: { boardId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    const maxPos = existing.length === 0 ? -1 : Math.max(...existing.map((c) => c.position));
    const position = body.position ?? maxPos + 1;
    const insertAt = clamp(position, 0, existing.length);
    const column = await prisma.$transaction(async (tx) => {
      for (let i = existing.length - 1; i >= insertAt; i--) {
        await tx.boardColumn.update({
          where: { id: existing[i].id },
          data: { position: i + 1 },
        });
      }
      return await tx.boardColumn.create({
        data: { boardId, title: body.title.trim(), position: insertAt },
        select: { id: true, title: true, position: true },
      });
    });
    res.status(201).json({ column });
  }),
);

const UpdateBoardColumnSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

router.patch(
  "/boards/:boardId/columns/:columnId",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { boardId, columnId } = BoardColumnIdParamSchema.parse(req.params);
    const body = UpdateBoardColumnSchema.parse(req.body);
    const existing = await prisma.boardColumn.findFirst({
      where: { id: columnId, boardId },
      select: { id: true, position: true },
    });
    if (!existing) throw new HttpError(404, "Column not found");
    if (body.title !== undefined && body.position === undefined) {
      const column = await prisma.boardColumn.update({
        where: { id: columnId },
        data: { title: body.title.trim() },
        select: { id: true, title: true, position: true },
      });
      res.json({ column });
      return;
    }
    if (body.position !== undefined) {
      const all = await prisma.boardColumn.findMany({
        where: { boardId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      const fromIdx = all.findIndex((c) => c.id === columnId);
      if (fromIdx < 0) throw new HttpError(404, "Column not found");
      const toIdx = clamp(body.position, 0, all.length - 1);
      if (fromIdx === toIdx && body.title === undefined) {
        const col = await prisma.boardColumn.findUniqueOrThrow({
          where: { id: columnId },
          select: { id: true, title: true, position: true },
        });
        res.json({ column: col });
        return;
      }
      const reordered = [...all];
      const [removed] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, removed);
      const offset = 10000;
      await prisma.$transaction(async (tx) => {
        for (const [i, c] of reordered.entries()) {
          await tx.boardColumn.update({
            where: { id: c.id },
            data: { position: offset + i },
          });
        }
        for (const [i, c] of reordered.entries()) {
          await tx.boardColumn.update({
            where: { id: c.id },
            data: { position: i },
          });
        }
      });
      if (body.title !== undefined) {
        await prisma.boardColumn.update({
          where: { id: columnId },
          data: { title: body.title.trim() },
        });
      }
    }
    const column = await prisma.boardColumn.findUniqueOrThrow({
      where: { id: columnId },
      select: { id: true, title: true, position: true },
    });
    res.json({ column });
  }),
);

router.delete(
  "/boards/:boardId/columns/:columnId",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { boardId, columnId } = BoardColumnIdParamSchema.parse(req.params);
    const col = await prisma.boardColumn.findFirst({
      where: { id: columnId, boardId },
      include: { _count: { select: { cards: true } }, cards: { select: { id: true, attachments: { select: { relativePath: true } } } } },
    });
    if (!col) throw new HttpError(404, "Column not found");
    const firstOther = await prisma.boardColumn.findFirst({
      where: { boardId, id: { not: columnId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (!firstOther) throw new HttpError(400, "Cannot delete the last column");
    for (const card of col.cards) {
      for (const a of card.attachments) {
        try {
          fs.rmSync(path.join(process.cwd(), a.relativePath), { force: true });
        } catch {
          // ignore
        }
      }
      const cardDir = path.join(process.cwd(), "uploads", card.id);
      try {
        fs.rmSync(cardDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await prisma.card.delete({ where: { id: card.id } });
    }
    await prisma.boardColumn.delete({ where: { id: columnId } });
    res.json({ ok: true });
  }),
);

// Archive (admin-only; no board context required for list/delete/download/restore)
router.get(
  "/archive",
  requireAdmin(),
  asyncHandler(async (_req, res) => {
    const files = listArchiveFilenames();
    res.json({ files });
  }),
);

const ArchiveFilenameParamSchema = z.object({ filename: z.string().min(1) });
router.delete(
  "/archive/:filename",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { filename } = ArchiveFilenameParamSchema.parse(req.params);
    deleteArchiveFile(filename);
    res.json({ ok: true });
  }),
);

router.get(
  "/archive/:filename/download",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { filename } = ArchiveFilenameParamSchema.parse(req.params);
    const absPath = getArchiveAbsolutePath(filename);
    if (!fs.existsSync(absPath)) throw new HttpError(404, "Архив не найден");
    res.download(absPath, filename);
  }),
);

const RestoreArchiveSchema = z.object({
  boardId: BoardIdSchema,
  columnId: z.string().uuid(),
});
router.post(
  "/archive/:filename/restore",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { filename } = ArchiveFilenameParamSchema.parse(req.params);
    const body = RestoreArchiveSchema.parse(req.body);
    const user = (req as any).user as { id: string };
    const { cardId } = await restoreCardFromArchive(filename, body.boardId, body.columnId, user.id);
    res.json({ cardId });
  }),
);

router.post(
  "/boards/:boardId/columns/:columnId/archive",
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { boardId, columnId } = BoardColumnIdParamSchema.parse(req.params);
    const col = await prisma.boardColumn.findFirst({
      where: { id: columnId, boardId },
      include: { cards: { orderBy: { position: "asc" }, include: { attachments: { select: { relativePath: true } } } } },
    });
    if (!col) throw new HttpError(404, "Column not found");
    for (const card of col.cards) {
      await createCardArchive(card.id);
      for (const a of card.attachments) {
        try {
          fs.rmSync(path.join(process.cwd(), a.relativePath), { force: true });
        } catch {
          // ignore
        }
      }
      await prisma.card.delete({ where: { id: card.id } });
      const cardDir = path.join(process.cwd(), "uploads", card.id);
      try {
        fs.rmSync(cardDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    res.json({ ok: true });
  }),
);

function requireBoardContext() {
  return asyncHandler(async (req, _res, next) => {
    const user = (req as any).user as { id: string; role: Role };
    const boardId = req.session.boardId;
    if (!boardId) throw new HttpError(400, "Board not selected");
    if (user.role !== Role.ADMIN) {
      const has = await prisma.boardMembership.findUnique({
        where: { boardId_userId: { boardId, userId: user.id } },
        select: { boardId: true },
      });
      if (!has) throw new HttpError(403, "Forbidden");
    }
    (req as any).boardId = boardId;
    next();
  });
}

router.use(requireBoardContext());

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const members = await prisma.boardMembership.findMany({
      where: { boardId },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { id: true, email: true, name: true, avatarPreset: true, avatarUploadName: true, role: true } } },
    });
    res.json({ users: members.map((m) => m.user) });
  }),
);

async function notifyCardParticipants(input: {
  cardId: string;
  actor: { id: string; name: string; email: string };
  event: "updated" | "moved";
  meta?: { fromColumn?: string; toColumn?: string };
}) {
  const card = await prisma.card.findUnique({
    where: { id: input.cardId },
    select: {
      id: true,
      description: true,
      column: { select: { title: true } },
      participants: {
        select: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              emailNotificationsEnabled: true,
            },
          },
        },
      },
    },
  });
  if (!card) return;

  const recipients = card.participants
    .map((p) => p.user)
    .filter(Boolean)
    .filter((u) => u.id !== input.actor.id)
    .filter((u) => u.emailNotificationsEnabled !== false)
    .map((u) => u.email)
    .filter(Boolean);

  if (recipients.length === 0) return;

  const subject =
    input.event === "moved"
      ? `Карточка перемещена: ${card.description}`
      : `Карточка изменена: ${card.description}`;

  const detailsLines: string[] = [
    `Карточка: ${card.description}`,
    `ID: ${card.id}`,
    `Событие: ${input.event === "moved" ? "перемещение" : "изменение"}`,
    `Кто: ${input.actor.name} <${input.actor.email}>`,
  ];

  if (input.event === "moved") {
    if (input.meta?.fromColumn) detailsLines.push(`Из: ${input.meta.fromColumn}`);
    detailsLines.push(`В: ${input.meta?.toColumn ?? card.column.title}`);
  } else {
    detailsLines.push(`Колонка: ${card.column.title}`);
  }

  await sendEmail({
    to: recipients,
    subject,
    text: detailsLines.join("\n"),
  });
}

router.get(
  "/board",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const boardColumns = await prisma.boardColumn.findMany({
      where: { boardId },
      orderBy: { position: "asc" },
      select: { id: true, title: true, position: true },
    });
    const columns = await Promise.all(
      boardColumns.map(async (col) => {
        const cards = await prisma.card.findMany({
          where: { boardId, columnId: col.id },
          orderBy: { position: "asc" },
          include: {
            _count: { select: { comments: true, attachments: true } },
          },
        });

        return {
          id: col.id,
          title: col.title,
          cards: cards.map((c) => ({
            id: c.id,
            description: c.description,
            assignee: c.assignee,
            dueDate: c.dueDate,
            column: col.id,
            position: c.position,
            importance: c.importance,
            paused: c.paused,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            commentCount: c._count.comments,
            attachmentCount: c._count.attachments,
          })),
        };
      }),
    );

    res.json({ columns });
  }),
);

/** Build SQL LIKE pattern from user query: * = any chars, escape % and _. By default wrap in % so plain text means "contains". */
function searchQueryToLike(q: string): string {
  const trimmed = q.trim();
  if (!trimmed) return "%";
  const escaped = trimmed
    .split("")
    .map((ch) => {
      if (ch === "%" || ch === "_" || ch === "\\") return "\\" + ch;
      return ch;
    })
    .join("");
  let pattern = escaped.replace(/\*/g, "%");
  if (!pattern.startsWith("%")) pattern = "%" + pattern;
  if (!pattern.endsWith("%")) pattern = pattern + "%";
  return pattern;
}

router.get(
  "/board/search",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const likePattern = searchQueryToLike(q);
    if (likePattern === "%") {
      res.json({ cards: [] });
      return;
    }
    type Row = {
      id: string;
      description: string;
      assignee: string | null;
      dueDate: Date | null;
      columnId: string;
      columnTitle: string;
      position: number;
      importance: string;
      paused: boolean;
      commentCount: bigint;
      attachmentCount: bigint;
    };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT c.id, c.description, c.assignee, c."dueDate", c."columnId", c.position, c.importance, c.paused,
             col.title AS "columnTitle",
             (SELECT COUNT(*) FROM "Comment" WHERE "cardId" = c.id)::int AS "commentCount",
             (SELECT COUNT(*) FROM "Attachment" WHERE "cardId" = c.id)::int AS "attachmentCount"
      FROM "Card" c
      JOIN "BoardColumn" col ON col.id = c."columnId"
      WHERE c."boardId" = ${boardId} AND c.description ILIKE ${likePattern} ESCAPE '\\'
      ORDER BY c."columnId", c.position
    `;
    res.json({
      cards: rows.map((r) => ({
        id: r.id,
        description: r.description,
        assignee: r.assignee,
        dueDate: r.dueDate,
        columnId: r.columnId,
        columnTitle: r.columnTitle,
        position: r.position,
        importance: r.importance,
        paused: r.paused,
        commentCount: Number(r.commentCount),
        attachmentCount: Number(r.attachmentCount),
      })),
    });
  }),
);

router.get(
  "/cards/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const card = await prisma.card.findFirst({
      where: { id, boardId },
      include: {
        column: { select: { id: true, title: true } },
        comments: { orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "asc" } },
        participants: { include: { user: { select: { id: true, email: true, name: true, avatarPreset: true, avatarUploadName: true } } } },
      },
    });
    if (!card) throw new HttpError(404, "Card not found");
    res.json({ card });
  }),
);

const CardCreateSchema = z.object({
  description: z.string().min(1),
  details: z.string().optional().nullable(),
  assignee: z.string().min(1).optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  columnId: z.string().uuid(),
  importance: z.enum(ImportanceIds).optional().default("MEDIUM"),
  paused: z.boolean().optional().default(false),
});

router.post(
  "/cards",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const data = CardCreateSchema.parse(req.body);
    const userId = (req as any).user.id as string;

    const boardColumn = await prisma.boardColumn.findFirst({
      where: { id: data.columnId, boardId },
      select: { id: true },
    });
    if (!boardColumn) throw new HttpError(400, "Invalid column for this board");

    const agg = await prisma.card.aggregate({
      where: { boardId, columnId: data.columnId },
      _max: { position: true },
    });
    const position = (agg._max.position ?? -1) + 1;

    const card = await prisma.card.create({
      data: {
        boardId,
        description: data.description,
        details: data.details ?? null,
        assignee: data.assignee ?? null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        columnId: data.columnId,
        position,
        importance: data.importance,
        paused: data.paused,
        authorId: userId,
      },
    });
    res.status(201).json({ card });
  }),
);

const CardUpdateSchema = z.object({
  description: z.string().min(1).optional(),
  details: z.string().nullable().optional(),
  assignee: z.string().min(1).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  importance: z.enum(ImportanceIds).optional(),
  paused: z.boolean().optional(),
});

router.patch(
  "/cards/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const data = CardUpdateSchema.parse(req.body);
    const actor = (req as any).user as { id: string; name: string; email: string; role: Role };

    const exists = await prisma.card.findFirst({ where: { id, boardId }, select: { id: true, authorId: true } });
    if (!exists) throw new HttpError(404, "Card not found");
    const canManage = actor.role === Role.ADMIN || (!!exists.authorId && exists.authorId === actor.id);
    if (data.assignee !== undefined && !canManage) throw new HttpError(403, "Forbidden");

    const card = await prisma.card.update({
      where: { id },
      data: {
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.details !== undefined ? { details: data.details } : {}),
        ...(data.assignee !== undefined ? { assignee: data.assignee } : {}),
        ...(data.dueDate !== undefined
          ? { dueDate: data.dueDate ? new Date(data.dueDate) : null }
          : {}),
        ...(data.importance !== undefined ? { importance: data.importance } : {}),
        ...(data.paused !== undefined ? { paused: data.paused } : {}),
      },
    });
    void notifyCardParticipants({ cardId: id, actor, event: "updated" }).catch(() => undefined);
    res.json({ card });
  }),
);

const CardMoveSchema = z.object({
  toColumnId: z.string().uuid(),
  toIndex: z.number().int().min(0),
});

router.post(
  "/cards/:id/move",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const { toColumnId, toIndex } = CardMoveSchema.parse(req.body);
    const actor = (req as any).user as { id: string; name: string; email: string };

    const toColumnExists = await prisma.boardColumn.findFirst({
      where: { id: toColumnId, boardId },
      select: { id: true, title: true },
    });
    if (!toColumnExists) throw new HttpError(400, "Invalid column for this board");

    const card = await prisma.card.findFirst({
      where: { id, boardId },
      include: { column: { select: { title: true } } },
    });
    if (!card) throw new HttpError(404, "Card not found");

    const fromColumnId = card.columnId;
    const fromCards = await prisma.card.findMany({
      where: { boardId, columnId: fromColumnId },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    const toCards =
      fromColumnId === toColumnId
        ? fromCards
        : await prisma.card.findMany({
            where: { boardId, columnId: toColumnId },
            orderBy: { position: "asc" },
            select: { id: true },
          });

    const fromIds = fromCards.map((c) => c.id);
    const toIds = toCards.map((c) => c.id);

    const removeFrom = (arr: string[]) => {
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1);
    };

    if (fromColumnId === toColumnId) {
      const ids = [...fromIds];
      removeFrom(ids);
      const idx = clamp(toIndex, 0, ids.length);
      ids.splice(idx, 0, id);

      await prisma.$transaction(
        ids.map((cardId, position) =>
          prisma.card.update({ where: { id: cardId }, data: { position } }),
        ),
      );
      res.json({ ok: true });
      return;
    }

    const newFrom = [...fromIds];
    removeFrom(newFrom);

    const newTo = [...toIds];
    removeFrom(newTo);
    const idx = clamp(toIndex, 0, newTo.length);
    newTo.splice(idx, 0, id);

    const tx = [
      ...newFrom.map((cardId, position) =>
        prisma.card.update({ where: { id: cardId }, data: { position } }),
      ),
      ...newTo.map((cardId, position) =>
        prisma.card.update({
          where: { id: cardId },
          data:
            cardId === id
              ? { columnId: toColumnId, position }
              : { position },
        }),
      ),
    ];

    await prisma.$transaction(tx);
    void notifyCardParticipants({
      cardId: id,
      actor,
      event: "moved",
      meta: { fromColumn: card.column.title, toColumn: toColumnExists.title },
    }).catch(() => undefined);
    res.json({ ok: true });
  }),
);

const AddParticipantSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
}).refine((v) => !!v.userId || !!v.email, { message: "userId or email is required" });

router.post(
  "/cards/:id/participants",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const cardId = z.string().uuid().parse(req.params.id);
    const actor = (req as any).user as { id: string; role: Role };
    const { email, userId } = AddParticipantSchema.parse(req.body);

    const card = await prisma.card.findFirst({ where: { id: cardId, boardId }, select: { id: true, authorId: true } });
    if (!card) throw new HttpError(404, "Card not found");
    const canManage = actor.role === Role.ADMIN || (!!card.authorId && card.authorId === actor.id);
    if (!canManage) throw new HttpError(403, "Forbidden");

    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, avatarPreset: true, avatarUploadName: true } })
      : await prisma.user.findUnique({ where: { email: email! }, select: { id: true, email: true, name: true, avatarPreset: true, avatarUploadName: true } });
    if (!user) throw new HttpError(404, "User not found");

    await prisma.cardParticipant.upsert({
      where: { cardId_userId: { cardId, userId: user.id } },
      create: { cardId, userId: user.id },
      update: {},
    });

    res.status(201).json({ participant: user });
  }),
);

router.delete(
  "/cards/:id/participants/:userId",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const cardId = z.string().uuid().parse(req.params.id);
    const userId = z.string().uuid().parse(req.params.userId);
    const actor = (req as any).user as { id: string; role: Role };

    const card = await prisma.card.findFirst({ where: { id: cardId, boardId }, select: { id: true, authorId: true } });
    if (!card) throw new HttpError(404, "Card not found");
    const canManage = actor.role === Role.ADMIN || (!!card.authorId && card.authorId === actor.id);
    if (!canManage) throw new HttpError(403, "Forbidden");

    await prisma.cardParticipant.deleteMany({ where: { cardId, userId } });
    res.json({ ok: true });
  }),
);

router.delete(
  "/cards/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const card = await prisma.card.findFirst({
      where: { id, boardId },
      select: { id: true, attachments: { select: { relativePath: true } } },
    });
    if (!card) throw new HttpError(404, "Card not found");

    await prisma.card.delete({ where: { id } });

    for (const a of card.attachments) {
      const abs = path.join(process.cwd(), a.relativePath);
      try {
        fs.rmSync(abs, { force: true });
      } catch {
        // ignore
      }
    }

    const cardDir = path.join(process.cwd(), "uploads", id);
    try {
      fs.rmSync(cardDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    res.json({ ok: true });
  }),
);

router.post(
  "/cards/:id/archive",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const actor = (req as any).user as { id: string; role: Role };
    const card = await prisma.card.findFirst({
      where: { id, boardId },
      select: { id: true, authorId: true, attachments: { select: { relativePath: true } } },
    });
    if (!card) throw new HttpError(404, "Card not found");
    const canManage = actor.role === Role.ADMIN || (!!card.authorId && card.authorId === actor.id);
    if (!canManage) throw new HttpError(403, "Forbidden");

    await createCardArchive(id);

    for (const a of card.attachments) {
      try {
        fs.rmSync(path.join(process.cwd(), a.relativePath), { force: true });
      } catch {
        // ignore
      }
    }
    await prisma.card.delete({ where: { id } });
    const cardDir = path.join(process.cwd(), "uploads", id);
    try {
      fs.rmSync(cardDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    res.json({ ok: true });
  }),
);

const CommentCreateSchema = z.object({
  body: z.string().min(1),
});

const CommentUpdateSchema = z.object({
  body: z.string().min(1),
});

router.post(
  "/cards/:id/comments",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const cardId = z.string().uuid().parse(req.params.id);
    const data = CommentCreateSchema.parse(req.body);
    const user = (req as any).user as { id: string; name: string; email: string; role: Role };

    const exists = await prisma.card.count({ where: { id: cardId, boardId } });
    if (!exists) throw new HttpError(404, "Card not found");

    const comment = await prisma.comment.create({
      data: {
        cardId,
        author: user.name,
        authorId: user.id,
        body: data.body,
      },
    });
    void notifyCardParticipants({ cardId, actor: { id: user.id, name: user.name, email: user.email }, event: "updated" }).catch(
      () => undefined,
    );
    res.status(201).json({ comment });
  }),
);

router.patch(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const data = CommentUpdateSchema.parse(req.body);
    const user = (req as any).user as { id: string; name: string; email: string; role: Role };

    const c = await prisma.comment.findUnique({
      where: { id },
      select: { authorId: true, cardId: true, card: { select: { boardId: true } } },
    });
    if (!c) throw new HttpError(404, "Comment not found");
    if (c.card.boardId !== boardId) throw new HttpError(404, "Comment not found");
    if (user.role !== Role.ADMIN && c.authorId !== user.id) throw new HttpError(403, "Forbidden");

    const comment = await prisma.comment.update({ where: { id }, data: { body: data.body } });
    void notifyCardParticipants({ cardId: c.cardId, actor: { id: user.id, name: user.name, email: user.email }, event: "updated" }).catch(
      () => undefined,
    );
    res.json({ comment });
  }),
);

router.delete(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const user = (req as any).user as { id: string; name: string; email: string; role: Role };
    const c = await prisma.comment.findUnique({
      where: { id },
      select: { authorId: true, cardId: true, card: { select: { boardId: true } } },
    });
    if (!c) throw new HttpError(404, "Comment not found");
    if (c.card.boardId !== boardId) throw new HttpError(404, "Comment not found");
    if (user.role !== Role.ADMIN && c.authorId !== user.id) throw new HttpError(403, "Forbidden");
    await prisma.comment.delete({ where: { id } });
    void notifyCardParticipants({ cardId: c.cardId, actor: { id: user.id, name: user.name, email: user.email }, event: "updated" }).catch(
      () => undefined,
    );
    res.json({ ok: true });
  }),
);

const uploadRoot = path.join(process.cwd(), "uploads");

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const raw = req.params.id;
    const cardId = Array.isArray(raw) ? raw[0] : raw;
    if (!cardId) return cb(new Error("Missing card id"), uploadRoot);
    const dest = path.join(uploadRoot, cardId);
    try {
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    } catch (e) {
      cb(e as Error, dest);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const storedName = `${crypto.randomUUID()}${ext}`;
    cb(null, storedName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  "/cards/:id/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const cardId = z.string().uuid().parse(req.params.id);
    const actor = (req as any).user as { id: string; name: string; email: string };
    if (!req.file) throw new HttpError(400, "File is required");

    const exists = await prisma.card.count({ where: { id: cardId, boardId } });
    if (!exists) throw new HttpError(404, "Card not found");

    // Multer/or browser may send original filename in a mojibake form.
    // Try to repair common UTF-8-as-latin1 cases (e.g. Cyrillic names).
    const repairedOriginalName = (() => {
      const raw = req.file.originalname;
      const converted = Buffer.from(raw, "latin1").toString("utf8");
      const looksMojibake = /[ÐÑÃ]/.test(raw);
      const hasCyrillic = /[А-Яа-яЁё]/.test(converted);
      if (looksMojibake && hasCyrillic) return converted;
      return raw;
    })();

    const relativePath = path.posix.join(
      "uploads",
      cardId,
      req.file.filename,
    );

    const attachment = await prisma.attachment.create({
      data: {
        cardId,
        filename: repairedOriginalName,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        relativePath,
      },
    });
    void notifyCardParticipants({ cardId, actor, event: "updated" }).catch(() => undefined);

    res.status(201).json({
      attachment: {
        ...attachment,
        url: `/${relativePath}`,
      },
    });
  }),
);

router.get(
  "/attachments/:id/download",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const att = await prisma.attachment.findUnique({
      where: { id },
      include: { card: { select: { boardId: true } } },
    });
    if (!att) throw new HttpError(404, "Attachment not found");
    if (att.card.boardId !== boardId) throw new HttpError(404, "Attachment not found");

    const abs = path.join(process.cwd(), att.relativePath);
    res.download(abs, att.filename);
  }),
);

router.delete(
  "/attachments/:id",
  asyncHandler(async (req, res) => {
    const boardId = (req as any).boardId as string;
    const id = z.string().uuid().parse(req.params.id);
    const actor = (req as any).user as { id: string; name: string; email: string };
    const att = await prisma.attachment.findUnique({
      where: { id },
      include: { card: { select: { boardId: true } } },
    });
    if (!att) throw new HttpError(404, "Attachment not found");
    if (att.card.boardId !== boardId) throw new HttpError(404, "Attachment not found");

    await prisma.attachment.delete({ where: { id } });
    void notifyCardParticipants({ cardId: att.cardId, actor, event: "updated" }).catch(() => undefined);
    const abs = path.join(process.cwd(), att.relativePath);
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      // ignore
    }
    res.json({ ok: true });
  }),
);

export { router };

