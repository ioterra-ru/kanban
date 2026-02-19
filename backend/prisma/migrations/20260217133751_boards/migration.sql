/*
  Warnings:

  - Added the required column `boardId` to the `Card` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Card_column_position_idx";

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "boardId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "defaultBoardId" TEXT;

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardMembership" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardMembership_pkey" PRIMARY KEY ("boardId","userId")
);

-- Seed default board and backfill existing data
INSERT INTO "Board" ("id", "name", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'Основная доска', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

UPDATE "Card" SET "boardId" = '00000000-0000-0000-0000-000000000001' WHERE "boardId" IS NULL;
UPDATE "User" SET "defaultBoardId" = '00000000-0000-0000-0000-000000000001' WHERE "defaultBoardId" IS NULL;

INSERT INTO "BoardMembership" ("boardId", "userId", "createdAt")
SELECT '00000000-0000-0000-0000-000000000001', "id", CURRENT_TIMESTAMP FROM "User"
ON CONFLICT ("boardId","userId") DO NOTHING;

ALTER TABLE "Card" ALTER COLUMN "boardId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Board_name_idx" ON "Board"("name");

-- CreateIndex
CREATE INDEX "BoardMembership_userId_idx" ON "BoardMembership"("userId");

-- CreateIndex
CREATE INDEX "Card_boardId_column_position_idx" ON "Card"("boardId", "column", "position");

-- CreateIndex
CREATE INDEX "Card_boardId_idx" ON "Card"("boardId");

-- CreateIndex
CREATE INDEX "User_defaultBoardId_idx" ON "User"("defaultBoardId");

-- AddForeignKey
ALTER TABLE "BoardMembership" ADD CONSTRAINT "BoardMembership_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMembership" ADD CONSTRAINT "BoardMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_defaultBoardId_fkey" FOREIGN KEY ("defaultBoardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
