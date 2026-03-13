#!/bin/bash
# Просмотр логов контейнера backend.
# Запуск из корня репозитория: ./scripts/logs-backend.sh [опции для docker compose logs]
# Пример: ./scripts/logs-backend.sh --tail 100

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

cd "$REPO_ROOT"
exec docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" logs backend "$@"
