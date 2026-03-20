#!/bin/bash
# Запуск приложения в контейнерах.
# Требуется docker/compose/.cont_one_app.env (скопировать из .example).
# Файл .cont_one_app.secrets.env создаётся из примера при отсутствии; SESSION_SECRET
# при необходимости генерируется скриптом (если нет или короче 16 символов).

set -euo pipefail

COMPOSE_ENV_DIR="docker/compose"
ENV_FILE="$COMPOSE_ENV_DIR/.cont_one_app.env"
SECRETS_FILE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env"
SECRETS_EXAMPLE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env.example"

if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: не найден файл $ENV_FILE" >&2
  echo "Скопируйте docker/compose/.cont_one_app.env.example в $ENV_FILE и задайте переменные." >&2
  exit 1
fi

# Создать файл секретов из примера, если его нет
if [ ! -f "$SECRETS_FILE" ]; then
  cp "$SECRETS_EXAMPLE" "$SECRETS_FILE"
  echo "Создан $SECRETS_FILE из примера."
fi

# Проверка обязательных переменных в .cont_one_app.env
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

missing=""
for var in APP_HOST ENABLE_HTTPS FRONTEND_HTTP_PORT FRONTEND_HTTPS_PORT CERTS_PATH \
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL BACKEND_PORT; do
  if [ -z "${!var:-}" ]; then
    missing="$missing $var"
  fi
done
if [ -n "$missing" ]; then
  echo "Ошибка: в файле $ENV_FILE не заданы переменные:$missing" >&2
  exit 1
fi

# Проверка и при необходимости генерация SESSION_SECRET (backend требует длину >= 16 символов)
set -a
# shellcheck source=/dev/null
source "$SECRETS_FILE"
set +a
if [ -z "${SESSION_SECRET:-}" ] || [ "${#SESSION_SECRET}" -lt 16 ]; then
  if ! command -v openssl &>/dev/null; then
    echo "Ошибка: для генерации SESSION_SECRET нужен openssl. Установите openssl или задайте SESSION_SECRET (не короче 16 символов) в $SECRETS_FILE" >&2
    exit 1
  fi
  NEW_SECRET=$(openssl rand -hex 32)
  if grep -q '^SESSION_SECRET=' "$SECRETS_FILE"; then
    # Portable sed: replace line (sed -i.bak on both Linux and macOS)
    sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$NEW_SECRET/" "$SECRETS_FILE" > "${SECRETS_FILE}.tmp" && mv "${SECRETS_FILE}.tmp" "$SECRETS_FILE"
  else
    echo "SESSION_SECRET=$NEW_SECRET" >> "$SECRETS_FILE"
  fi
  echo "Сгенерирован и сохранён SESSION_SECRET в $SECRETS_FILE"
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
  set +a
fi

# Генерация самоподписанного сертификата, если включён HTTPS и сертификатов ещё нет
if [ "${ENABLE_HTTPS}" = "true" ]; then
  CERTS_DIR="${CERTS_PATH}"
  CERT_CRT="$CERTS_DIR/kanban.crt"
  CERT_KEY="$CERTS_DIR/kanban.key"
  mkdir -p "$CERTS_DIR"
  if [ ! -f "$CERT_CRT" ] || [ ! -f "$CERT_KEY" ]; then
    echo "Генерация самоподписанного TLS-сертификата для хоста: $APP_HOST"
    docker run --rm -v "$(pwd)/$CERTS_DIR:/out" alpine:3.20 sh -c \
      "apk add --no-cache openssl >/dev/null && \
       openssl req -x509 -newkey rsa:2048 -nodes \
         -keyout /out/kanban.key \
         -out /out/kanban.crt \
         -days 3650 \
         -subj \"/CN=$APP_HOST\" \
         -addext 'subjectAltName=DNS:$APP_HOST,DNS:localhost,IP:127.0.0.1' \
       >/dev/null 2>&1"
    echo "Созданы: $CERT_CRT и $CERT_KEY"
  fi
fi

docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" -f docker-compose-base.yml -f docker-compose-prod.yml up -d --build

# URL для вывода (формируется так же, как в backend: из APP_HOST и портов)
if [ "$ENABLE_HTTPS" = "true" ]; then
  base_url="https://${APP_HOST}:${FRONTEND_HTTPS_PORT}"
else
  base_url="http://${APP_HOST}:${FRONTEND_HTTP_PORT}"
fi
echo
echo "OK. UI:      $base_url"
echo "Adminer: $base_url/adminer/"
