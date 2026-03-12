#!/bin/bash
# Запуск приложения в контейнерах.
# Конфигурация: docker/compose/.cont_one_app.env (редактируется пользователем).
# Секреты: docker/compose/.cont_one_app.secrets.env (создаётся при первом запуске).

set -euo pipefail

COMPOSE_ENV_DIR="docker/compose"
ENV_FILE="$COMPOSE_ENV_DIR/.cont_one_app.env"
SECRETS_FILE="$COMPOSE_ENV_DIR/.cont_one_app.secrets.env"
mkdir -p "$COMPOSE_ENV_DIR"

# Файл конфигурации обязателен; при первом запуске копируем из примера
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$COMPOSE_ENV_DIR/.cont_one_app.env.example" ]; then
    cp "$COMPOSE_ENV_DIR/.cont_one_app.env.example" "$ENV_FILE"
    echo "Created $ENV_FILE from example. Edit it if needed, then run again."
    exit 0
  else
    echo "Missing $ENV_FILE. Copy from .cont_one_app.env.example and set variables." >&2
    exit 1
  fi
fi

# Подставляем переменные из .cont_one_app.env
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# PUBLIC_BASE_URL и CORS_ORIGIN формируются из APP_HOST и портов (как в docker-compose.yml), если не заданы
if [ -z "${PUBLIC_BASE_URL:-}" ]; then
  if [ "${ENABLE_HTTPS:-true}" = "true" ]; then
    export PUBLIC_BASE_URL="https://${APP_HOST:-localhost}:${FRONTEND_HTTPS_PORT:-8443}"
    export CORS_ORIGIN="https://${APP_HOST:-localhost}:${FRONTEND_HTTPS_PORT:-8443},https://localhost:${FRONTEND_HTTPS_PORT:-8443},https://127.0.0.1:${FRONTEND_HTTPS_PORT:-8443}"
  else
    export PUBLIC_BASE_URL="http://${APP_HOST:-localhost}:${FRONTEND_HTTP_PORT:-8080}"
    export CORS_ORIGIN="http://${APP_HOST:-localhost}:${FRONTEND_HTTP_PORT:-8080},http://localhost:${FRONTEND_HTTP_PORT:-8080},http://127.0.0.1:${FRONTEND_HTTP_PORT:-8080}"
  fi
elif [ -z "${CORS_ORIGIN:-}" ]; then
  export CORS_ORIGIN="$PUBLIC_BASE_URL"
fi

# Генерация самоподписанного сертификата, если включён HTTPS и сертификатов ещё нет
if [ "${ENABLE_HTTPS:-true}" = "true" ]; then
  CERTS_DIR="${CERTS_PATH:-./certs}"
  CERT_CRT="$CERTS_DIR/kanban.crt"
  CERT_KEY="$CERTS_DIR/kanban.key"
  mkdir -p "$CERTS_DIR"
  if [ ! -f "$CERT_CRT" ] || [ ! -f "$CERT_KEY" ]; then
    echo "Generating self-signed TLS certificate for host: ${APP_HOST:-localhost}"
    docker run --rm -v "$(pwd)/$CERTS_DIR:/out" alpine:3.20 sh -c \
      "apk add --no-cache openssl >/dev/null && \
       openssl req -x509 -newkey rsa:2048 -nodes \
         -keyout /out/kanban.key \
         -out /out/kanban.crt \
         -days 3650 \
         -subj \"/CN=${APP_HOST:-localhost}\" \
         -addext 'subjectAltName=DNS:${APP_HOST:-localhost},DNS:localhost,IP:127.0.0.1' \
       >/dev/null 2>&1"
    echo "Created: $CERT_CRT and $CERT_KEY"
  fi
fi

# Файл секретов — создаём только если ещё нет
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Creating $SECRETS_FILE (set SESSION_SECRET and SMTP as needed)"
  secret="$(docker run --rm alpine:3.20 sh -c "apk add --no-cache openssl >/dev/null && openssl rand -hex 32" 2>/dev/null | tr -d '\r\n')"
  cat > "$SECRETS_FILE" <<EOF
# Секреты (DO NOT COMMIT). Отредактируйте SESSION_SECRET и SMTP.
SESSION_SECRET=$secret

SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
fi

docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" up -d --build

echo
echo "OK. UI:      ${PUBLIC_BASE_URL}"
echo "Adminer: ${PUBLIC_BASE_URL}/adminer/"
