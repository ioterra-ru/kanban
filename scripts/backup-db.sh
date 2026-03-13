#!/bin/bash
# Создать бэкап БД (для переноса на облачный сервер).
# Запуск из корня репозитория: ./scripts/backup-db.sh
# Результат: backup/kanban-YYYY-MM-DDTHHMMSS.sql

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_ENV_DIR="$REPO_ROOT/docker/compose"
ENV_FILE="$COMPOSE_ENV_DIR/.cont_one_app.env"
SECRETS_FILE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env"
BACKUP_DIR="$REPO_ROOT/backup"

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

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%SZ")
BACKUP_FILE="$BACKUP_DIR/kanban-$TIMESTAMP.sql"

cd "$REPO_ROOT"
if ! docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" ps -q db 2>/dev/null | head -1 | grep -q .; then
  echo "Ошибка: контейнер db не запущен. Сначала запустите приложение (./run_one_app.sh)." >&2
  exit 1
fi

echo "Создание бэкапа: $BACKUP_FILE"
docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --clean --if-exists \
  > "$BACKUP_FILE"

echo "Готово. Файл: $BACKUP_FILE"
echo "Размер: $(du -h "$BACKUP_FILE" | cut -f1)"
