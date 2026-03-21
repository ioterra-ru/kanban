#!/bin/bash
# Отключить 2FA у всех пользователей в БД.
# После переноса дампа TOTP-секреты лежат в той же БД (они не «привязаны к серверу»), но
# коды могут не проходить из-за сильного сдвига времени на новой машине (NTP) или если нужно
# срочно разблокировать вход. Скрипт сбрасывает 2FA; вход по паролю, затем при желании 2FA снова в профиле.
#
# Запуск из корня репозитория:
#   ./scripts/disable-2fa-after-migration.sh
#
# Требования: docker compose с сервисом db; env-файлы в docker/compose/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
    echo "Запустите из корня репозитория или задайте KANBAN_REPO_ROOT." >&2
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

cd "$REPO_ROOT"
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE")

if ! "${COMPOSE_CMD[@]}" ps -q db 2>/dev/null | head -1 | grep -q .; then
  echo "Запуск контейнера db..."
  "${COMPOSE_CMD[@]}" up -d db
  echo "Ожидание готовности БД..."
  "${COMPOSE_CMD[@]}" exec db pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -q
  sleep 2
fi

echo "Отключение 2FA у всех пользователей..."
"${COMPOSE_CMD[@]}" exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c \
  'UPDATE "User" SET "totpEnabled" = false, "totpSecret" = null, "totpTempSecret" = null;'

echo "Готово. Пользователи могут входить по паролю и при необходимости снова включить 2FA в профиле."
