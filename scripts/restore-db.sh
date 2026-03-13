#!/bin/bash
# Развернуть бэкап БД на этом сервере (заменить текущую базу).
# Использовать на облачном сервере после копирования файла бэкапа.
#
# Запуск из корня репозитория:
#   ./scripts/restore-db.sh backup/kanban-2026-03-12T123456Z.sql
#   ./scripts/restore-db.sh  # если один файл в backup/
#
# Требования: docker compose с сервисом db; env-файлы в docker/compose/.
# Backend будет остановлен на время восстановления.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_ENV_DIR="$REPO_ROOT/docker/compose"
ENV_FILE="$COMPOSE_ENV_DIR/.cont_one_app.env"
SECRETS_FILE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: не найден $ENV_FILE" >&2
  exit 1
fi
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Ошибка: не найден $SECRETS_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
# shellcheck source=/dev/null
source "$SECRETS_FILE"
set +a

if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
  if [[ "$BACKUP_FILE" != /* ]]; then
    BACKUP_FILE="$REPO_ROOT/$BACKUP_FILE"
  fi
else
  LATEST=$(ls -t "$REPO_ROOT/backup"/kanban-*.sql 2>/dev/null | head -1)
  if [ -z "$LATEST" ]; then
    echo "Ошибка: файл бэкапа не указан и в backup/ нет kanban-*.sql" >&2
    echo "Использование: $0 [путь/к/backup/kanban-YYYY-MM-DDTHHMMSS.sql]" >&2
    exit 1
  fi
  BACKUP_FILE="$LATEST"
  echo "Выбран последний бэкап: $BACKUP_FILE"
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Ошибка: файл не найден: $BACKUP_FILE" >&2
  exit 1
fi

cd "$REPO_ROOT"
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE")

echo "Остановка backend и frontend (чтобы не держали соединения с БД)..."
"${COMPOSE_CMD[@]}" stop backend frontend 2>/dev/null || true

if ! "${COMPOSE_CMD[@]}" ps -q db 2>/dev/null | head -1 | grep -q .; then
  echo "Запуск контейнера db..."
  "${COMPOSE_CMD[@]}" up -d db
  echo "Ожидание готовности БД..."
  "${COMPOSE_CMD[@]}" exec db pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q
  sleep 2
fi

echo "Восстановление из $BACKUP_FILE ..."
cat "$BACKUP_FILE" | "${COMPOSE_CMD[@]}" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -q

echo "Запуск backend и frontend..."
"${COMPOSE_CMD[@]}" up -d backend frontend

echo "Готово. База заменена бэкапом."
