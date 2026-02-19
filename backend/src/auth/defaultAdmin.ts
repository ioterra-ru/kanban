import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import { hashPassword } from "./password.js";
import { randomAvatarPreset } from "./avatarPresets.js";

const DEFAULT_BOARD_ID = "00000000-0000-0000-0000-000000000001";

async function ensureDefaultBoard() {
  await prisma.board.upsert({
    where: { id: DEFAULT_BOARD_ID },
    create: { id: DEFAULT_BOARD_ID, name: "Основная доска" },
    update: {},
  });
  return DEFAULT_BOARD_ID;
}

export async function ensureDefaultAdmin() {
  const boardId = await ensureDefaultBoard();

  const count = await prisma.user.count();
  if (count === 0) {
    const passwordHash = await hashPassword("admin");
    const admin = await prisma.user.create({
      data: {
        email: "admin@local",
        name: "Администратор",
        avatarPreset: randomAvatarPreset(),
        role: Role.ADMIN,
        isSystem: true,
        passwordHash,
        mustChangePassword: true,
        totpEnabled: false,
        defaultBoardId: boardId,
      },
    });
    await prisma.boardMembership.upsert({
      where: { boardId_userId: { boardId, userId: admin.id } },
      create: { boardId, userId: admin.id },
      update: {},
    });
    // eslint-disable-next-line no-console
    console.log("Default admin created: login=admin password=admin (must change password)");
    return;
  }

  // Ensure there is exactly one system admin marker (oldest admin)
  const systemCount = await prisma.user.count({ where: { isSystem: true } });
  if (systemCount === 0) {
    const oldestAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (oldestAdmin) {
      await prisma.user.update({ where: { id: oldestAdmin.id }, data: { isSystem: true } });
    }
  }

  // Backfill defaults and memberships for existing users
  const users = await prisma.user.findMany({
    select: { id: true, defaultBoardId: true },
  });

  // ensure every user has default board
  await prisma.$transaction(
    users
      .filter((u) => !u.defaultBoardId)
      .map((u) => prisma.user.update({ where: { id: u.id }, data: { defaultBoardId: boardId } })),
  );

  // ensure membership for default board for users who have none
  const usersWithMembershipCount = await prisma.user.findMany({
    select: { id: true, defaultBoardId: true, _count: { select: { boardMemberships: true } } },
  });

  await prisma.$transaction(
    usersWithMembershipCount
      .filter((u) => u._count.boardMemberships === 0)
      .map((u) =>
        prisma.boardMembership.create({
          data: { boardId: u.defaultBoardId ?? boardId, userId: u.id },
        }),
      ),
  );

  // ensure every user has an avatar preset
  const withoutAvatar = await prisma.user.findMany({
    where: { avatarPreset: null },
    select: { id: true },
  });
  if (withoutAvatar.length) {
    await prisma.$transaction(
      withoutAvatar.map((u) => prisma.user.update({ where: { id: u.id }, data: { avatarPreset: randomAvatarPreset() } })),
    );
  }
}

