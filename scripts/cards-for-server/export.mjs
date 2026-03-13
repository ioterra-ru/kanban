/**
 * Экспорт только досок, колонок и карточек (без пользователей) в JSON.
 * Для переноса на сервер, где пользователи уже есть.
 *
 * Запуск из корня репозитория:
 *   cd scripts/cards-for-server && npm install && node export.mjs
 * Конфиг: docker/compose/.cont_one_app.env (DATABASE_URL).
 * Результат: backup/kanban-cards-YYYY-MM-DDTHHMMSSZ.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const composeDir = path.join(repoRoot, "docker", "compose");
const backupDir = path.join(repoRoot, "backup");

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

const client = new pg.Client({ connectionString: DATABASE_URL });

const q = `
  SELECT
    b.id AS "boardId", b.name AS "boardName", b.description AS "boardDescription",
    bc.id AS "columnId", bc.title AS "columnTitle", bc.position AS "columnPosition",
    c.id AS "cardId", c.description AS "cardDescription", c.details AS "cardDetails",
    c.assignee AS "cardAssignee", c."dueDate" AS "cardDueDate",
    c.position AS "cardPosition", c.importance AS "cardImportance", c.paused AS "cardPaused"
  FROM "Board" b
  JOIN "BoardColumn" bc ON bc."boardId" = b.id
  JOIN "Card" c ON c."columnId" = bc.id
  ORDER BY b.name, bc.position, c.position
`;

async function run() {
  await client.connect();
  const res = await client.query(q);
  await client.end();

  const boardsMap = new Map();
  for (const row of res.rows) {
    const boardKey = row.boardId;
    if (!boardsMap.has(boardKey)) {
      boardsMap.set(boardKey, {
        name: row.boardName,
        description: row.boardDescription ?? null,
        columns: [],
      });
    }
    const board = boardsMap.get(boardKey);
    let col = board.columns.find((c) => c.title === row.columnTitle && c.position === row.columnPosition);
    if (!col) {
      col = {
        title: row.columnTitle,
        position: row.columnPosition,
        cards: [],
      };
      board.columns.push(col);
    }
    col.cards.push({
      description: row.cardDescription,
      details: row.cardDetails ?? null,
      assignee: row.cardAssignee ?? null,
      dueDate: row.cardDueDate ? row.cardDueDate.toISOString() : null,
      position: row.cardPosition,
      importance: row.cardImportance,
      paused: row.cardPaused,
    });
  }

  const boards = Array.from(boardsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  boards.forEach((b) => b.columns.sort((a, b) => a.position - b.position));

  const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const outFile = path.join(backupDir, `kanban-cards-${timestamp}.json`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ boards }, null, 2), "utf8");
  console.log("Экспорт карточек готов:", outFile);
  console.log("Досок:", boards.length, "Карточек:", boards.reduce((s, b) => s + b.columns.reduce((t, c) => t + c.cards.length, 0), 0));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
