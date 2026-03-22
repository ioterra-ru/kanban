import fs from "node:fs";
import path from "node:path";
// @ts-expect-error no types for archiver
import archiver from "archiver";
import unzipper from "unzipper";

import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { HttpError } from "./utils/httpError.js";

const uploadRoot = path.join(process.cwd(), "uploads");

/** Safe filename from card description: strip path, limit length, replace invalid chars. */
export function sanitizeArchiveBasename(description: string, cardId: string): string {
  const safe = description
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "card";
  const suffix = cardId.slice(0, 8);
  return `${safe}_${suffix}`;
}

function ensureArchiveDir(): string {
  const dir = env.ARCHIVE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** List .zip filenames in archive directory. */
export function listArchiveFilenames(): string[] {
  const dir = ensureArchiveDir();
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".zip"));
  } catch {
    return [];
  }
}

/** Validate filename: only base name, no path traversal. */
function assertSafeArchiveFilename(filename: string): void {
  const base = path.basename(filename);
  if (base !== filename || !base.endsWith(".zip") || base.includes("..")) {
    throw new HttpError(400, "Invalid archive filename");
  }
}

export function getArchiveAbsolutePath(filename: string): string {
  assertSafeArchiveFilename(filename);
  return path.join(ensureArchiveDir(), filename);
}

export function deleteArchiveFile(filename: string): void {
  const abs = getArchiveAbsolutePath(filename);
  try {
    fs.unlinkSync(abs);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new HttpError(404, "Архив не найден");
    throw e;
  }
}

export async function createCardArchive(cardId: string): Promise<string> {
  const card = await prisma.card.findFirst({
    where: { id: cardId },
    include: {
      column: { select: { id: true, title: true } },
      comments: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
      participants: { select: { userId: true } },
    },
  });
  if (!card) throw new HttpError(404, "Card not found");

  const basename = sanitizeArchiveBasename(card.description, card.id);
  const filename = `${basename}.zip`;
  const dir = ensureArchiveDir();
  const outPath = path.join(dir, filename);

  const cardJson = {
    card: {
      description: card.description,
      details: card.details,
      assignee: card.assignee,
      dueDate: card.dueDate?.toISOString() ?? null,
      importance: card.importance,
      paused: card.paused,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    },
    comments: card.comments.map((c) => ({
      author: c.author,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    participants: card.participants.map((p) => p.userId),
    attachments: card.attachments.map((a) => ({
      filename: a.filename,
      storedName: a.storedName,
      mimeType: a.mimeType,
      size: a.size,
    })),
  };

  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  await new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));
    archive.pipe(output);

    archive.append(JSON.stringify(cardJson, null, 2), { name: "card.json" });

    const cardUploadsDir = path.join(uploadRoot, cardId);
    if (fs.existsSync(cardUploadsDir)) {
      const files = fs.readdirSync(cardUploadsDir);
      for (const f of files) {
        const full = path.join(cardUploadsDir, f);
        if (fs.statSync(full).isFile()) {
          archive.file(full, { name: `attachments/${f}` });
        }
      }
    }

    archive.finalize();
  });

  return filename;
}

type RestoreCardPayload = {
  description: string;
  details: string | null;
  assignee: string | null;
  dueDate: string | null;
  importance: string;
  paused: boolean;
  comments: Array<{ author: string | null; authorId: string | null; body: string; createdAt: string }>;
  participants: string[];
  attachments: Array<{ filename: string; storedName: string; mimeType: string; size: number }>;
};

/** card.json сейчас: { card: { ... }, comments, participants, attachments }. Раньше мог быть плоский объект. */
function parseArchiveCardJson(jsonStr: string): RestoreCardPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new HttpError(400, "Некорректный JSON в card.json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Некорректный card.json");
  }
  const root = parsed as Record<string, unknown>;
  const cardSection =
    root.card !== undefined && root.card !== null && typeof root.card === "object" && !Array.isArray(root.card)
      ? (root.card as Record<string, unknown>)
      : root;

  const rawDesc = cardSection.description;
  const description =
    typeof rawDesc === "string" && rawDesc.trim() !== ""
      ? rawDesc.trim()
      : rawDesc !== undefined && rawDesc !== null && String(rawDesc).trim() !== ""
        ? String(rawDesc).trim()
        : "Карточка из архива";

  const rawDetails = cardSection.details;
  const details =
    rawDetails === undefined || rawDetails === null ? null : String(rawDetails);

  const rawAssignee = cardSection.assignee;
  const assignee =
    rawAssignee === undefined || rawAssignee === null || rawAssignee === ""
      ? null
      : String(rawAssignee);

  const rawDue = cardSection.dueDate;
  const dueDate =
    rawDue === undefined || rawDue === null || rawDue === ""
      ? null
      : typeof rawDue === "string"
        ? rawDue
        : null;

  const imp = cardSection.importance;
  const importance = typeof imp === "string" && imp ? imp : "MEDIUM";

  return {
    description,
    details,
    assignee,
    dueDate,
    importance,
    paused: Boolean(cardSection.paused),
    comments: Array.isArray(root.comments) ? (root.comments as RestoreCardPayload["comments"]) : [],
    participants: Array.isArray(root.participants)
      ? (root.participants as unknown[]).filter((p): p is string => typeof p === "string")
      : [],
    attachments: Array.isArray(root.attachments) ? (root.attachments as RestoreCardPayload["attachments"]) : [],
  };
}

export async function restoreCardFromArchive(
  filename: string,
  boardId: string,
  columnId: string,
  authorId: string | null,
): Promise<{ cardId: string }> {
  assertSafeArchiveFilename(filename);
  const absPath = getArchiveAbsolutePath(filename);
  if (!fs.existsSync(absPath)) throw new HttpError(404, "Архив не найден");

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true },
  });
  if (!board) throw new HttpError(404, "Доска не найдена");
  const col = await prisma.boardColumn.findFirst({
    where: { id: columnId, boardId },
    select: { id: true },
  });
  if (!col) throw new HttpError(404, "Колонка не найдена");

  const dir = await unzipper.Open.file(absPath);
  const cardEntry = dir.files.find((f) => f.path === "card.json");
  if (!cardEntry) throw new HttpError(400, "В архиве нет card.json");
  const cardJsonStr = (await cardEntry.buffer()).toString("utf8");
  const data = parseArchiveCardJson(cardJsonStr);

  const agg = await prisma.card.aggregate({
    where: { boardId, columnId },
    _max: { position: true },
  });
  const position = (agg._max.position ?? -1) + 1;

  const newCard = await prisma.$transaction(async (tx) => {
    const card = await tx.card.create({
      data: {
        boardId,
        columnId,
        position,
        description: data.description,
        details: data.details ?? null,
        assignee: data.assignee ?? null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        importance: (data.importance as "LOW" | "MEDIUM" | "HIGH") || "MEDIUM",
        paused: data.paused,
        authorId,
      },
    });

    for (const c of data.comments ?? []) {
      await tx.comment.create({
        data: {
          cardId: card.id,
          author: c.author ?? undefined,
          authorId: c.authorId ?? undefined,
          body: c.body,
        },
      });
    }

    for (const userId of data.participants ?? []) {
      try {
        await tx.cardParticipant.create({ data: { cardId: card.id, userId } });
      } catch {
        // skip if user no longer exists
      }
    }

    const destDir = path.join(uploadRoot, card.id);
    fs.mkdirSync(destDir, { recursive: true });

    for (const att of data.attachments ?? []) {
      const entry = dir.files.find((f) => f.path === `attachments/${att.storedName}`);
      if (!entry) continue;
      const buf = await entry.buffer();
      const destPath = path.join(destDir, att.storedName);
      fs.writeFileSync(destPath, buf);
      const relativePath = path.posix.join("uploads", card.id, att.storedName);
      await tx.attachment.create({
        data: {
          cardId: card.id,
          filename: att.filename,
          storedName: att.storedName,
          mimeType: att.mimeType,
          size: att.size,
          relativePath,
        },
      });
    }

    return card;
  });

  return { cardId: newCard.id };
}
