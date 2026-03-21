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
#
# Набор compose-файлов подбирается автоматически, если не заданы COMPOSE_FILE или KANBAN_COMPOSE_FILE.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Корень репозитория: либо KANBAN_REPO_ROOT, либо каталог с docker/compose
if [ -n "${KANBAN_REPO_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$KANBAN_REPO_ROOT" && pwd)"
else
  REPO_ROOT=""
  for candidate in "$SCRIPT_DIR/.." "$SCRIPT_DIR"; do
    dir="$(cd "$candidate" 2>/dev/null && pwd)"
    if [ -f "$dir/docker/compose/.cont_one_app.env" ]; then
      REPO_ROOT="$dir"
      break
    fi
  done
  if [ -z "$REPO_ROOT" ]; then
    echo "Ошибка: не найден каталог с docker/compose/.cont_one_app.env" >&2
    echo "Запустите скрипт из корня репозитория kanban или задайте переменную KANBAN_REPO_ROOT:" >&2
    echo "  cd /path/to/kanban && ./scripts/restore-db.sh backup/файл.sql" >&2
    echo "  KANBAN_REPO_ROOT=/path/to/kanban $0 backup/файл.sql" >&2
    exit 1
  fi
fi

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
kanban_export_compose_file
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
