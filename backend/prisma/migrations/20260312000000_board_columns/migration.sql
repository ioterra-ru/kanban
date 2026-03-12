-- CreateTable
CREATE TABLE "BoardColumn" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "BoardColumn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardColumn_boardId_position_key" ON "BoardColumn"("boardId", "position");

-- CreateIndex
CREATE INDEX "BoardColumn_boardId_idx" ON "BoardColumn"("boardId");

-- AddForeignKey
ALTER TABLE "BoardColumn" ADD CONSTRAINT "BoardColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create default columns for each existing board (Backlog, High priority, ToDo, In Progress, Ready For Acceptance, Done)
INSERT INTO "BoardColumn" ("id", "boardId", "title", "position")
SELECT gen_random_uuid(), b.id, v.title, v.ord
FROM "Board" b
CROSS JOIN (VALUES
  (0::integer, 'Backlog'::text),
  (1, 'High priority'),
  (2, 'ToDo'),
  (3, 'In Progress'),
  (4, 'Ready For Acceptance'),
  (5, 'Done')
) AS v(ord, title);

-- Add columnId to Card (nullable first)
ALTER TABLE "Card" ADD COLUMN "columnId" TEXT;

-- Migrate: set columnId from existing column enum (enum order: BACKLOG=0, HIGH_PRIORITY=1, ...)
UPDATE "Card" c
SET "columnId" = bc.id
FROM "BoardColumn" bc
WHERE bc."boardId" = c."boardId"
  AND bc."position" = (
    SELECT array_position(enum_range(NULL::"Column"), c."column")::integer - 1
  );

-- Make columnId NOT NULL and add FK
ALTER TABLE "Card" ALTER COLUMN "columnId" SET NOT NULL;
ALTER TABLE "Card" ADD CONSTRAINT "Card_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Drop old column and enum
DROP INDEX IF EXISTS "Card_boardId_column_position_idx";
ALTER TABLE "Card" DROP COLUMN "column";
CREATE INDEX "Card_boardId_columnId_position_idx" ON "Card"("boardId", "columnId", "position");

-- DropEnum
DROP TYPE "Column";
