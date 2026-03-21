#!/usr/bin/env bash
# Сброс пароля пользователя по email (обход почты и 2FA).
# Запуск на сервере под root/админом по SSH, из корня репозитория с docker compose.
#
# Использование:
#   ./scripts/admin-reset-user-password.sh user@example.com
#
# Набор compose-файлов подбирается автоматически (как в backup-db / restore-db), если не заданы
# COMPOSE_FILE или KANBAN_COMPOSE_FILE.
#
# Требования: docker compose, сервисы db и образ backend (для bcrypt, как в приложении).
# После сброса у пользователя "mustChangePassword" = true — при первом входе попросит сменить пароль.

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

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "Использование: $0 <email>" >&2
  echo "Пример: $0 admin@local" >&2
  exit 1
fi

escape_sql() {
  printf '%s' "$1" | sed "s/'/''/g"
}

EMAIL_ESC="$(escape_sql "$EMAIL")"

cd "$REPO_ROOT"
kanban_export_compose_file
COMPOSE_CMD=(docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE")

if ! "${COMPOSE_CMD[@]}" ps -q db 2>/dev/null | head -1 | grep -q .; then
  echo "Ошибка: контейнер db не запущен. Запустите: docker compose up -d db" >&2
  exit 1
fi

USER_ID="$("${COMPOSE_CMD[@]}" exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -A -c \
  "SELECT id FROM \"User\" WHERE lower(email) = lower('${EMAIL_ESC}') LIMIT 1;" | tr -d '[:space:]')"

if [ -z "$USER_ID" ]; then
  echo "Ошибка: пользователь с email «${EMAIL}» не найден." >&2
  exit 1
fi

read -r -s -p "Новый пароль (мин. 8 символов): " P1
echo
read -r -s -p "Повторите пароль: " P2
echo
if [ "$P1" != "$P2" ]; then
  echo "Ошибка: пароли не совпадают." >&2
  exit 1
fi
if [ "${#P1}" -lt 8 ]; then
  echo "Ошибка: пароль короче 8 символов." >&2
  exit 1
fi

PWFILE="$(mktemp)"
chmod 600 "$PWFILE"
cleanup() {
  rm -f "$PWFILE"
}
trap cleanup EXIT
printf '%s' "$P1" >"$PWFILE"

echo "Генерация хеша пароля (образ backend)…"
# Пароль из файла — без проблем с кавычками и $ в docker -e
RAW_OUT="$("${COMPOSE_CMD[@]}" run --rm --no-deps -T \
  -v "$PWFILE:/tmp/.kanban_pw:ro" \
  backend \
  node -e 'const fs=require("fs");const bcrypt=require("bcryptjs");const p=fs.readFileSync("/tmp/.kanban_pw","utf8");console.log(bcrypt.hashSync(p,12));' 2>&1)"

trap - EXIT
cleanup

# compose run иногда пишет служебные строки в stdout — берём последнюю строку, похожую на bcrypt
HASH="$(printf '%s\n' "$RAW_OUT" | tr -d '\r' | grep -E '^\$2[aby]\$[0-9]+\$' | tail -n 1)"

if [ -z "$HASH" ]; then
  echo "Ошибка: не удалось получить bcrypt-хеш. Вывод команды:" >&2
  printf '%s\n' "$RAW_OUT" >&2
  exit 1
fi

HASH_ESC="$(escape_sql "$HASH")"
UID_ESC="$(escape_sql "$USER_ID")"

echo "Обновление пароля и сброс сессий…"
"${COMPOSE_CMD[@]}" exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c \
  "UPDATE \"User\" SET \"passwordHash\" = '${HASH_ESC}', \"mustChangePassword\" = true WHERE id = '${UID_ESC}'; \
   DELETE FROM \"session\" WHERE (sess->'user'->>'userId') = '${UID_ESC}';"

echo "Готово. Пользователь «${EMAIL}» может войти с новым паролем; при входе система может потребовать сменить пароль ещё раз (флаг обязательной смены)."
