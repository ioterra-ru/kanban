#!/bin/bash
# Создать бэкап БД (для переноса на облачный сервер).
# Запуск из корня репозитория: ./scripts/backup-db.sh
# Результат: backup/kanban-YYYY-MM-DDTHHMMSSZ.sql
#
# Набор compose-файлов (base+prod / base+dev / docker-compose.yml) подбирается автоматически,
# если не заданы COMPOSE_FILE или KANBAN_COMPOSE_FILE.

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

kanban_export_compose_file() {
  if [ -n "${KANBAN_COMPOSE_FILE:-}" ]; then
    export COMPOSE_FILE="${KANBAN_COMPOSE_FILE}"
    return
  fi
  if [ -n "${COMPOSE_FILE:-}" ]; then
    return
  fi
  local ccf_root="${REPO_ROOT:?}"
  local -a ccf_ef=(--env-file "${ENV_FILE:?}" --env-file "${SECRETS_FILE:?}")
  local ccf_matched=""

  if [ -f "$ccf_root/docker-compose-base.yml" ] && [ -f "$ccf_root/docker-compose-prod.yml" ]; then
    if docker compose "${ccf_ef[@]}" -f docker-compose-base.yml -f docker-compose-prod.yml ps -q db 2>/dev/null | head -1 | grep -q .; then
      export COMPOSE_FILE=docker-compose-base.yml:docker-compose-prod.yml
      ccf_matched=1
    fi
  fi

  if [ -z "$ccf_matched" ] && [ -f "$ccf_root/docker-compose-base.yml" ] && [ -f "$ccf_root/docker-compose-dev.yml" ]; then
    if docker compose "${ccf_ef[@]}" -f docker-compose-base.yml -f docker-compose-dev.yml ps -q db 2>/dev/null | head -1 | grep -q .; then
      export COMPOSE_FILE=docker-compose-base.yml:docker-compose-dev.yml
      ccf_matched=1
    fi
  fi

  if [ -z "$ccf_matched" ]; then
    if docker compose "${ccf_ef[@]}" ps -q db 2>/dev/null | head -1 | grep -q .; then
      ccf_matched=1
    fi
  fi

  if [ -z "$ccf_matched" ]; then
    if [ -f "$ccf_root/docker-compose-base.yml" ] && [ -f "$ccf_root/docker-compose-prod.yml" ]; then
      export COMPOSE_FILE=docker-compose-base.yml:docker-compose-prod.yml
    elif [ -f "$ccf_root/docker-compose-base.yml" ] && [ -f "$ccf_root/docker-compose-dev.yml" ]; then
      export COMPOSE_FILE=docker-compose-base.yml:docker-compose-dev.yml
    fi
  fi
}

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%SZ")
BACKUP_FILE="$BACKUP_DIR/kanban-$TIMESTAMP.sql"

cd "$REPO_ROOT"
kanban_export_compose_file

if ! docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" ps -q db 2>/dev/null | head -1 | grep -q .; then
  echo "Ошибка: контейнер db не запущен. Запустите: ./run_one_app_dev.sh, ./run_one_app_prod.sh или docker compose up -d db." >&2
  exit 1
fi

echo "Создание бэкапа: $BACKUP_FILE"
docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" exec -T db \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --clean --if-exists \
  > "$BACKUP_FILE"

echo "Готово. Файл: $BACKUP_FILE"
echo "Размер: $(du -h "$BACKUP_FILE" | cut -f1)"
