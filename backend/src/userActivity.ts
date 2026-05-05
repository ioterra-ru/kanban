import { prisma } from "./prisma.js";

export type UserActivityKind =
  | "COMMENT_ADD"
  | "COMMENT_EDIT"
  | "COMMENT_DELETE"
  | "CARD_CREATE"
  | "CARD_UPDATE"
  | "CARD_MOVE"
  | "PARTICIPANT_ADD"
  | "PARTICIPANT_REMOVE"
  | "ATTACHMENT_ADD"
  | "CARD_ARCHIVE"
  | "CARD_DELETE"
  | "FAVORITE_ADD"
  | "FAVORITE_REMOVE";

/** Best-effort; never throws to callers. */
export function logUserActivity(input: {
  userId: string;
  kind: UserActivityKind;
  cardId?: string | null;
  boardId?: string | null;
  summary: string;
}): void {
  const summary = input.summary.length > 2000 ? input.summary.slice(0, 1997) + "…" : input.summary;
  void prisma.userActivityLog
    .create({
      data: {
        userId: input.userId,
        kind: input.kind,
        cardId: input.cardId ?? null,
        boardId: input.boardId ?? null,
        summary,
      },
    })
    .catch(() => undefined);
}
