/**
 * Восстановление только карточек из JSON на сервере.
 * Доски и колонки создаются при отсутствии (по имени/заголовку).
 * Карточки создаются без привязки к пользователям (authorId = null).
 *
 * Запуск на сервере из корня репозитория:
 *   cd scripts/cards-for-server && npm install && node restore.mjs backup/kanban-cards-YYYYMMDDTHHMMSSZ.json
 * Конфиг: docker/compose/.cont_one_app.env (DATABASE_URL).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const composeDir = path.join(repoRoot, "docker", "compose");

dotenv.config({ path: path.join(composeDir, ".cont_one_app.env") });
const secretsPath = path.join(composeDir, ".cont_one_app.secrets.env");
if (fs.existsSync(secretsPath)) dotenv.config({ path: secretsPath });

let DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL?.includes("@db:")) {
  DATABASE_URL = DATABASE_URL.replace("@db:", "@localhost:");
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL не задан (docker/compose/.cont_one_app.env)");
  process.exit(1);
}

const backupPath = process.argv[2];
if (!backupPath) {
  console.error("Укажите путь к файлу: node restore.mjs backup/kanban-cards-....json");
  process.exit(1);
}
const fullPath = path.isAbsolute(backupPath) ? backupPath : path.join(repoRoot, backupPath);
if (!fs.existsSync(fullPath)) {
  console.error("Файл не найден:", fullPath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
const boards = data.boards ?? [];
if (boards.length === 0) {
  console.log("Нет досок в файле.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function getOrCreateBoard(name, description) {
  const r = await client.query('SELECT id FROM "Board" WHERE name = $1', [name]);
  if (r.rows.length) return r.rows[0].id;
  const ins = await client.query(
    'INSERT INTO "Board" (id, name, description, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, NOW(), NOW()) RETURNING id',
    [name, description ?? null]
  );
  return ins.rows[0].id;
}

async function getOrCreateColumn(boardId, title, position) {
  const r = await client.query('SELECT id FROM "BoardColumn" WHERE "boardId" = $1 AND title = $2', [boardId, title]);
  if (r.rows.length) return r.rows[0].id;
  const ins = await client.query(
    'INSERT INTO "BoardColumn" (id, "boardId", title, position) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
    [boardId, title, position]
  );
  return ins.rows[0].id;
}

async function getNextPosition(boardId, columnId) {
  const r = await client.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM "Card" WHERE "boardId" = $1 AND "columnId" = $2',
    [boardId, columnId]
  );
  return r.rows[0].next;
}

async function run() {
  await client.connect();
  let cardsCreated = 0;
  for (const board of boards) {
    const boardId = await getOrCreateBoard(board.name, board.description);
    for (const col of board.columns ?? []) {
      const columnId = await getOrCreateColumn(boardId, col.title, col.position);
      for (const card of col.cards ?? []) {
        const position = await getNextPosition(boardId, columnId);
        await client.query(
          `INSERT INTO "Card" (id, "boardId", "columnId", description, details, assignee, "dueDate", position, importance, paused, "authorId", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, NULL, NOW(), NOW())`,
          [
            boardId,
            columnId,
            card.description,
            card.details ?? null,
            card.assignee ?? null,
            card.dueDate ?? null,
            position,
            card.importance ?? "MEDIUM",
            card.paused ?? false,
          ]
        );
        cardsCreated++;
      }
    }
  }
  await client.end();
  console.log("Готово. Создано карточек:", cardsCreated);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
