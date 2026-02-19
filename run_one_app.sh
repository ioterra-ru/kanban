#!/bin/bash
# Скрипт запускает контейнеры приложения (one app).
# Можно передать имя хоста первым аргументом (по умолчанию: $HOSTNAME).

set -euo pipefail

srv="${HOSTNAME:-localhost}"
if [ -n "${1:-}" ]; then
  srv="$1"
fi

CERT_DIR="certs"
CERT_CRT="$CERT_DIR/kanban.crt"
CERT_KEY="$CERT_DIR/kanban.key"
mkdir -p "$CERT_DIR"

# Self-signed certificate for local HTTPS (replace with real cert in production).
if [ ! -f "$CERT_CRT" ] || [ ! -f "$CERT_KEY" ]; then
  echo "Generating self-signed TLS certificate for host: $srv"
  # Use a throwaway container so we don't depend on openssl on host
  # and can still write files even if certs/ is root-owned.
  docker run --rm -v "$(pwd)/$CERT_DIR:/out" alpine:3.20 sh -c \
    "apk add --no-cache openssl >/dev/null && \
     openssl req -x509 -newkey rsa:2048 -nodes \
       -keyout /out/kanban.key \
       -out /out/kanban.crt \
       -days 3650 \
       -subj '/CN=$srv' \
       -addext 'subjectAltName=DNS:$srv,DNS:localhost,IP:127.0.0.1' \
     >/dev/null 2>&1"
  echo "Created: $CERT_CRT and $CERT_KEY"
fi

ENV_FILE="docker/compose/.cont_one_app.env"
SECRETS_FILE="docker/compose/.cont_one_app.secrets.env"
mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
APP_HOST=$srv
PUBLIC_BASE_URL=https://$srv:8443
CORS_ORIGIN=https://$srv:8443,https://localhost:8443,https://127.0.0.1:8443
EOF
fi

sed -i "s/^APP_HOST=.*/APP_HOST=$srv/" "$ENV_FILE"
if grep -q "^PUBLIC_BASE_URL=" "$ENV_FILE"; then
  sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$srv:8443#" "$ENV_FILE"
else
  echo "PUBLIC_BASE_URL=https://$srv:8443" >> "$ENV_FILE"
fi

if ! grep -q "^CORS_ORIGIN=" "$ENV_FILE"; then
  echo "CORS_ORIGIN=https://$srv:8443,https://localhost:8443,https://127.0.0.1:8443" >> "$ENV_FILE"
fi

extra_env=""
if [ ! -f "$SECRETS_FILE" ]; then
  echo "Creating secrets file: $SECRETS_FILE"
  secret="$(docker run --rm alpine:3.20 sh -c "apk add --no-cache openssl >/dev/null && openssl rand -hex 32" 2>/dev/null | tr -d '\r\n')"
  cat > "$SECRETS_FILE" <<EOF
# Secrets for IoTerra-Kanban (DO NOT COMMIT)
SESSION_SECRET=$secret

# SMTP (optional). If SMTP_HOST is empty, emails are disabled.
#
# mp-co.ru is hosted on Mail.ru (MX: emx.mail.ru). Typical settings:
# - host: smtp.mail.ru
# - port: 465
# - secure: true
#
# IMPORTANT:
# - SMTP_USER should be the full mailbox login (e.g. kanban@mp-co.ru)
# - SMTP_FROM is recommended to match SMTP_USER (same mailbox)
# - If the mailbox has 2FA enabled, you usually need an app password.
SMTP_HOST=smtp.mail.ru
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF
fi

extra_env="--env-file $SECRETS_FILE"

docker compose --env-file "$ENV_FILE" $extra_env up -d --build

echo
echo "OK. UI:      https://localhost:8443"
echo "Adminer: https://localhost:8443/adminer/"

