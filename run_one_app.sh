#!/bin/bash
# Запуск приложения в контейнерах.
# Требуются: docker/compose/.cont_one_app.env и docker/compose/.cont_one_app.secrets.env
# (скопировать из .example и заполнить). Скрипт env-файлы не создаёт и не меняет.

set -euo pipefail

COMPOSE_ENV_DIR="docker/compose"
ENV_FILE="$COMPOSE_ENV_DIR/.cont_one_app.env"
SECRETS_FILE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: не найден файл $ENV_FILE" >&2
  echo "Скопируйте docker/compose/.cont_one_app.env.example в $ENV_FILE и задайте переменные." >&2
  exit 1
fi

if [ ! -f "$SECRETS_FILE" ]; then
  echo "Ошибка: не найден файл $SECRETS_FILE" >&2
  echo "Скопируйте docker/compose/.cont_one_app.secrets.env.example в $SECRETS_FILE и задайте SESSION_SECRET (и SMTP при необходимости)." >&2
  exit 1
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

# Проверка SESSION_SECRET в секретах
set -a
# shellcheck source=/dev/null
source "$SECRETS_FILE"
set +a
if [ -z "${SESSION_SECRET:-}" ]; then
  echo "Ошибка: в файле $SECRETS_FILE не задана переменная SESSION_SECRET" >&2
  exit 1
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

docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" up -d --build

# URL для вывода (формируется так же, как в backend: из APP_HOST и портов)
if [ "$ENABLE_HTTPS" = "true" ]; then
  base_url="https://${APP_HOST}:${FRONTEND_HTTPS_PORT}"
else
  base_url="http://${APP_HOST}:${FRONTEND_HTTP_PORT}"
fi
echo
echo "OK. UI:      $base_url"
echo "Adminer: $base_url/adminer/"
