#!/bin/bash
# Запуск приложения в контейнерах.
# Требуется docker/compose/.cont_one_app.env (скопировать из .example).
# Файл .cont_one_app.secrets.env создаётся из примера при отсутствии; SESSION_SECRET
# при необходимости генерируется скриптом (если нет или короче 16 символов).
#
# Опция --proxy: перед сборкой Docker экспортировать HTTP_PROXY/HTTPS_PROXY из
# $ENV_FILE (уже подгружены) и при необходимости встроить PROXY_USER/PROXY_PASSWORD
# из secrets в URL, если в URL ещё нет userinfo. Пример: ./run_one_app_dev.sh --proxy

set -euo pipefail

USE_PROXY_BUILD=0
_filtered_args=()
for arg in "$@"; do
  if [ "$arg" = "--proxy" ]; then
    USE_PROXY_BUILD=1
  else
    _filtered_args+=("$arg")
  fi
done
set -- "${_filtered_args[@]}"
unset _filtered_args

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

# Прокси для build: BuildKit читает HTTP(S)_PROXY из окружения клиента.
if [ "$USE_PROXY_BUILD" = "1" ]; then
  if [ -z "${HTTP_PROXY:-}" ] && [ -z "${HTTPS_PROXY:-}" ]; then
    echo "Ошибка: с ключом --proxy задайте в $ENV_FILE переменные HTTP_PROXY и/или HTTPS_PROXY." >&2
    exit 1
  fi
  if [ -n "${PROXY_USER:-}" ] && ! command -v python3 &>/dev/null; then
    echo "Ошибка: задан PROXY_USER, но нет python3 — нужен для встраивания логина/пароля в URL прокси." >&2
    exit 1
  fi
  if [ -n "${PROXY_USER:-}" ]; then
    eval "$(python3 <<'PY'
import os, shlex
from urllib.parse import urlparse, urlunparse, quote

def inject(url: str, user: str, password: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not user:
        return url
    p = urlparse(url)
    if p.username is not None:
        return url
    host = p.hostname
    if not host:
        return url
    u = quote(user, safe="")
    pw = quote(password or "", safe="")
    netloc = f"{u}:{pw}@{host}"
    if p.port is not None:
        netloc += f":{p.port}"
    return urlunparse((p.scheme, netloc, p.path or "", p.params, p.query, p.fragment))

http = os.environ.get("HTTP_PROXY", "")
https = os.environ.get("HTTPS_PROXY", "")
user = os.environ.get("PROXY_USER", "")
pw = os.environ.get("PROXY_PASSWORD", "")

http_i = inject(http, user, pw)
https_i = inject(https, user, pw)
if not https_i and http_i:
    https_i = http_i
if not http_i and https_i:
    http_i = https_i

no = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or "localhost,127.0.0.1,db,127.0.0.0/8"

for k, v in (
    ("HTTP_PROXY", http_i),
    ("HTTPS_PROXY", https_i),
    ("NO_PROXY", no),
    ("http_proxy", http_i),
    ("https_proxy", https_i),
    ("no_proxy", no),
):
    print(f"export {k}={shlex.quote(v)}")
PY
)"
  else
    : "${HTTPS_PROXY:=${HTTP_PROXY:-}}"
    : "${HTTP_PROXY:=${HTTPS_PROXY:-}}"
    export HTTP_PROXY HTTPS_PROXY
    export NO_PROXY="${NO_PROXY:-${no_proxy:-localhost,127.0.0.1,db,127.0.0.0/8}}"
    export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" no_proxy="$NO_PROXY"
  fi
  echo "Сборка через прокси (HTTP_PROXY/HTTPS_PROXY из $ENV_FILE)."
  echo "Подробный вывод сборки (--progress plain): иначе кажется, что процесс «завис» на последней строке TTY, пока параллельно идёт долгий npm ci в другом образе." >&2
fi

_compose_progress=()
if [ "$USE_PROXY_BUILD" = "1" ]; then
  _compose_progress=(--progress plain)
fi
docker compose "${_compose_progress[@]}" --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" -f docker-compose-base.yml -f docker-compose-dev.yml up --build
unset _compose_progress

# URL для вывода (формируется так же, как в backend: из APP_HOST и портов)
echo
if [ "$ENABLE_HTTPS" = "true" ]; then
  base_url="https://${APP_HOST}:${FRONTEND_HTTPS_PORT}"
  http_entry="http://${APP_HOST}:${FRONTEND_HTTP_PORT}"
  echo "OK. Локальный HTTPS:"
  echo "     UI:  $base_url  (основной адрес; самоподписанный сертификат — примите предупреждение в браузере)"
  echo "     Также: $http_entry → редирект на HTTPS (порт ${FRONTEND_HTTPS_PORT})"
else
  base_url="http://${APP_HOST}:${FRONTEND_HTTP_PORT}"
  echo "OK. UI:      $base_url"
fi
#echo "Adminer: $base_url/adminer/"
